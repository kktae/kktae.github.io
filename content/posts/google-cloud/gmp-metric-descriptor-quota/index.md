---
title: "Google Managed Service for Prometheus 메트릭 디스크립터 할당량 관리 가이드"
date: 2026-05-07
summary: "Managed Service for Prometheus 메트릭 디스크립터 할당량 관리와 카디널리티 폭증 예방 절차"
tags: ["GCP", "Monitoring", "Prometheus", "Quota"]
---
## 1. 개요

Google Managed Service for Prometheus (이하 GMP) 는 Cloud Monitoring 의 Monarch 백엔드를 사용하여 Prometheus 메트릭을 수집, 저장, 조회합니다. GMP 가 수집하는 메트릭은 Cloud Monitoring 의 일반 메트릭 모델과 동일한 *메트릭 디스크립터(metric descriptor)* 단위로 등록되며, 디스크립터 수에는 **프로젝트당 25,000개**라는 강한 한도가 적용됩니다. 한도에 근접하면 신규 메트릭 등록이 거부되고, 청구 가능 메트릭의 누적은 수집과 저장 비용을 비례적으로 증가시킵니다.

본 가이드는 GMP 환경에서 Prometheus 메트릭 디스크립터 할당량 사용률이 임계치(예: 70%, 80%) 에 도달한 프로젝트를 안전하고 재현 가능하게 정리하기 위한 표준 운영 절차를 다룹니다. 다음과 같은 4단계 패턴을 제안합니다.

1. **식별 (Identify)**: Metrics Management 와 Metrics Explorer 로 비활성과 미사용 청구 가능 메트릭을 식별합니다.
2. **삭제 (Delete)**: 더 이상 필요하지 않은 메트릭 디스크립터를 안전하게 일괄 삭제합니다.
3. **차단 (Exclude)**: 신규 수집을 사전에 차단하기 위해 메트릭 제외 규칙을 설정합니다.
4. **예방 (Prevent)**: 수집 단계에서 `metricRelabeling` 과 카디널리티 관리 규칙을 적용하여 재발을 막습니다.

본 문서는 특정 프로젝트의 트러블슈팅 보고서가 아니라, 동일한 증상을 겪는 모든 GCP 고객이 재사용할 수 있는 표준 운영 가이드를 목표로 합니다.

## 2. 메트릭 디스크립터 할당량 이해

### 2.1 할당량 한도

Cloud Monitoring 은 메트릭 디스크립터 수와 디스크립터 생성 속도를 모두 프로젝트 단위로 제한합니다. GMP 메트릭은 `prometheus.googleapis.com/...` 네임스페이스 아래에 등록되며 두 번째 행의 한도가 적용됩니다.

| 항목 | 한도 | 비고 |
|---|---|---|
| 사용자 정의 메트릭(`custom.googleapis.com/...`) 디스크립터 | 10,000 / 프로젝트 | Cloud Monitoring 이 강제 |
| Workload, Prometheus(GMP), External 메트릭 디스크립터 | 25,000 / 프로젝트 | GMP 의 핵심 한도 |
| 메트릭 디스크립터 생성 속도 | 6,000 / 분 / 프로젝트 | 신규 메트릭/라벨 정의 변경에만 적용. 데이터 포인트 수집 속도 제한 아님 |
| 시계열당 활성 시계열 (모니터링 리소스당) | Prometheus 1,000,000 / 그 외 200,000 | 디스크립터와 별개 |

> "Although this quota can be lifted by request if your metrics are well-formed, it is far more likely that you hit this limit because you are ingesting malformed metric names into the system."
>
> 출처: *Stackdriver / Managed Prometheus, Troubleshooting*

할당량 상향은 가능하지만, 메트릭 정의가 정돈되지 않은 상태로 신청하면 승인되지 않을 수 있습니다. 상향 이전에 본 가이드의 4단계를 우선 적용하는 것을 권장합니다.

### 2.2 메트릭 상태 정의

Metrics Management 페이지는 모든 메트릭을 다음 세 가지 축으로 분류합니다.

| 상태 | 정의 | 비용 발생 여부 |
|---|---|---|
| Active (활성) | 최근 25시간 이내에 데이터 포인트가 수집된 청구 가능 메트릭 | 발생 |
| Inactive (비활성) | 최근 25시간 동안 데이터가 수집되지 않은 청구 가능 메트릭 | 미발생 |
| Unused billable (미사용 청구 가능) | 활성 상태이지만 최근 30일 동안 쿼리되지 않았고 알림 정책과 커스텀 대시보드 어디에도 포함되지 않은 메트릭 | 발생 (관측 가치는 거의 없음) |

> "Unused billable metrics are active metrics that have not been queried in the last 30 days and are not used in a custom dashboard or alerting policy. These metrics incur ingestion costs but are not providing observability benefits."
>
> 출처: *Cloud Monitoring, Metrics management*

비활성 메트릭은 비용을 유발하지 않지만, **디스크립터 수에는 그대로 카운트**된다는 점이 핵심입니다. 즉, 한 번 등록된 디스크립터는 데이터를 더 이상 수신하지 않더라도 할당량을 계속 차지합니다. 이것이 비용 절감 관점에서는 잠잠한 비활성 메트릭이 디스크립터 할당량 관점에서는 가장 시급한 정리 대상이 되는 이유입니다.

### 2.3 할당량을 잠식하는 일반적인 패턴

GMP 환경에서 메트릭 디스크립터 폭증을 일으키는 원인의 대다수는 **차원 정보를 메트릭 이름에 인코딩**하는 안티패턴입니다.

> "Prometheus has a dimensional data model where information such as cluster or namespace name should get encoded as a label value. When dimensional information is instead embedded in the metric name itself, then the number of metric descriptors increases indefinitely."
>
> 출처: *Stackdriver / Managed Prometheus, Cost controls*

Prometheus 데이터 모델에서 클러스터, 네임스페이스, 요청 경로 같은 동적 정보는 *라벨 값* 으로 표현되어야 합니다. 이러한 동적 정보가 메트릭 이름에 포함되면 매 인스턴스와 매 요청마다 새로운 메트릭 이름이 만들어지고, 결과적으로 디스크립터가 무한히 늘어납니다. 다음과 같은 메트릭 이름은 즉시 의심해야 합니다.

```text
request_path_____path_to_a_resource____istio_request_duration_milliseconds
envoy_cluster_grpc_method_name_failure
vault_rollback_attempt_path_name_1700683024
service__________________________________________latency_bucket
```

이러한 패턴은 다음 익스포터와 구성에서 자주 발생합니다.

- **StatsD 익스포터**: 라벨 매핑 규칙을 정의하지 않으면 디멘션을 메트릭 이름에 그대로 인코딩합니다.
- **Vault 익스포터**: `path` 등 동적 값을 메트릭 이름에 포함하는 기본 동작이 있습니다.
- **Envoy / Istio 사이드카 메트릭**: 라벨 매핑 미설정 시 클러스터와 메서드 이름이 메트릭 이름에 인코딩됩니다.
- **자체 배포 cAdvisor**: 컨테이너 라벨과 환경 변수를 동적으로 메트릭 이름에 주입하는 옵션이 활성화된 경우.
- **kube-state-metrics**: 절대량 자체가 매우 큽니다. 3노드 클러스터 기준 약 900 samples/sec.

## 3. Step 1: 비활성과 미사용 청구 가능 메트릭 식별

### 3.1 사전 권한

Metrics Management 페이지의 모든 기능을 사용하려면 다음 IAM 역할이 필요합니다.

- `roles/monitoring.editor`: 제외 규칙 생성, 편집, 삭제, Metrics Management 보기
- `roles/logging.privateLogViewer`: Cloud Audit Logs 에서 제외 규칙 변경 이력 확인 (선택)

### 3.2 Metrics Management UI 절차 (Quick filters)

Quick filters 패널은 **한 번에 하나의 필터만** 선택할 수 있습니다. 단일 클릭으로 정리 후보를 좁히는 1차 식별 단계입니다. 여러 조건을 동시에 적용해야 한다면 다음 절(§3.3) 의 Filter bar 를 사용합니다.

1. Cloud Console 에서 [Metrics Management 페이지](https://console.cloud.google.com/monitoring/metrics-management) 로 이동합니다.
2. 도구 모음의 시간 범위를 확인합니다 (기본은 직전 1일).
3. **Quick filters** 패널에서 다음 중 **하나의** 단일 필터를 선택하여 후보를 좁힙니다.
   - **Metric status: Inactive**: 최근 25시간 동안 데이터가 들어오지 않은 메트릭. 비용은 발생하지 않지만 디스크립터 한도는 차지합니다.
   - **Metric usage: Unused billable**: 정의상 이미 *활성이면서* 최근 30일간 쿼리, 커스텀 대시보드, 알림 정책 어디에서도 참조되지 않은 메트릭. 비용 절감 1순위.
   - **Metric usage: Idle**: 정의상 *비활성이면서* 30일간 미참조인 메트릭. 비용은 발생하지 않지만 디스크립터 한도 정리 1순위.
   - **No alert policies** / **No custom dashboards**: 현재 프로젝트의 알림 정책과 커스텀 대시보드에 참조되지 않은 메트릭.
4. 결과 표를 **Bytes billable volume** 또는 **Samples billable volume** 열로 정렬하여 눈에 띄는 패턴(매우 긴 이름, 일관된 prefix 등)을 확인합니다.

### 3.3 정밀 식별을 위한 컴파운드 필터

Metrics Management 의 **Filter** 막대는 다중 조건을 결합할 수 있습니다. 기본은 AND 결합이고, 두 조건 사이에 명시적으로 `OR` 필터를 삽입할 수도 있습니다. 다음 조합은 "정말로 안전하게 정리해도 되는 메트릭"을 좁혀 들어가는 데 유용합니다.

| 시나리오 | 필터 조합 | 의미 |
|---|---|---|
| 비활성 + 알림과 대시보드 미참조 | `Status: Inactive` AND `Alert Policies: (Empty)` AND `Custom Dashboards: (Empty)` | 가장 안전한 1차 정리 대상 |
| 활성이지만 미사용 청구 가능 | `Status: Active` AND `Metric usage: Unused` | 비용 절감 대상 |
| 잘못된 패턴 추정 | `Metric type` 정규식 + `Status: Active` | 정규식 기반 후보 추출 |
| 특정 익스포터 출처 | `Metric type` prefix(예: `prometheus.googleapis.com/envoy_`) | 익스포터별 정리 |

> [!NOTE]
> **메트릭 범위 주의:** Metrics Management 페이지는 **현재 프로젝트** 의 알림 정책과 커스텀 대시보드만 검색합니다. 다른 프로젝트의 metrics scope 에서 해당 메트릭을 참조하고 있더라도 "참조 없음" 으로 표시될 수 있습니다. 멀티 프로젝트 환경에서는 메트릭 삭제 전에 metrics scope 내 다른 프로젝트의 알림과 대시보드 사용 여부를 별도로 확인합니다.

### 3.4 Metrics Explorer 로 큰 손실 메트릭 식별

볼륨 기준으로 가장 비용을 많이 유발하는 메트릭을 보조 식별할 때는 Metrics Explorer 의 *Metric Ingestion Attribution* 리소스를 사용합니다.

1. [Metrics Explorer](https://console.cloud.google.com/monitoring/metrics-explorer) 로 이동합니다.
2. 메트릭으로 `monitoring.googleapis.com/collection/attribution/write_sample_count` (UI 라벨: *Samples written by attribution id*) 를 선택합니다.
3. 집계: `sum`, By: `attribution_dimension`, `metric_type`.
4. 필터: `attribution_dimension = namespace`.
5. 값 기준 내림차순 정렬로 상위 메트릭 타입을 확인합니다.

특정 고볼륨 메트릭의 출처 네임스페이스가 궁금하다면 위 쿼리에 `metric_type=<해당 메트릭 타입>` 필터를 추가하고 By 절을 `attribution_dimension`, `attribution_id` 로 바꿉니다. 이 절차는 *Managed Service for Prometheus: Cost controls* 문서의 "Identify high-volume metrics" 가이드를 따릅니다.

## 4. Step 2: 메트릭 디스크립터 일괄 삭제

### 4.1 삭제의 영향과 주의 사항

> [!WARNING]
> 메트릭 디스크립터 삭제는 비가역적입니다. 디스크립터를 삭제하면 해당 메트릭의 **시계열 데이터까지 함께 삭제**되며, 시스템 정의 디스크립터(`<service>.googleapis.com/...`)는 삭제할 수 없습니다. 또한 동일한 메트릭이 다시 수집되면 디스크립터는 자동으로 재생성되므로, **디스크립터 삭제만으로는 신규 수집을 막을 수 없습니다.** 수집 차단을 함께 설정하지 않으면 곧 같은 디스크립터가 다시 등장합니다 (Step 3, Step 4 와 병행 필요).

요약하면 디스크립터 삭제는 다음 두 조건이 모두 성립할 때 안전합니다.

- 해당 메트릭의 과거 시계열 데이터가 알림, 대시보드, 분석에 더 이상 필요하지 않음
- 신규 수집을 차단하는 메트릭 제외 규칙 또는 수집 단계 필터가 함께 적용됨

### 4.2 권한과 API

- 필요 권한: `monitoring.metricDescriptors.delete` (포함 역할: `roles/monitoring.editor`)
- API 메서드: `projects.metricDescriptors.delete`
- 리소스 경로: `projects/PROJECT_ID/metricDescriptors/METRIC_TYPE`

### 4.3 삭제 방식 비교

복수의 디스크립터를 일괄 삭제할 때는 다음 4가지 옵션이 있습니다. 한도(분당 6,000건)를 고려하여 청크 단위로 호출해야 합니다.

| 방식 | 장점 | 단점 / 주의 |
|---|---|---|
| GCP 공개 Golang 스크립트 (`prometheus-engine/examples/scripts/delete_metric_descriptors`) | dry-run 모드 내장, 정규식 기반 매칭, GMP 팀이 공식 권장 | Go 빌드 환경 필요, 자체 검토 후 사용 |
| `gcloud monitoring metrics-descriptors delete` | gcloud 만으로 동작, 스크립트화 용이 | 단건 단위 호출, 자체 dry-run 지원 없음 |
| REST API + `curl` | 의존성 최소, 어디서나 실행 가능 | 인증 토큰 갱신과 재시도 로직을 직접 작성해야 함 |
| 클라이언트 라이브러리 (Python/Go 등) | 페이지네이션, 정규식 매칭, dry-run 가드를 완전히 제어 | 라이브러리 설치와 인증 셋업 필요 |

### 4.4 GCP 공개 Golang 스크립트 사용 절차

GMP 팀이 제공하는 공식 스크립트는 GitHub `GoogleCloudPlatform/prometheus-engine` 저장소에 포함되어 있으며, GMP 환경에서 발생하는 잘못된 디스크립터 정리에 가장 적합합니다.

1. 저장소를 클론합니다.
   ```bash
   git clone https://github.com/GoogleCloudPlatform/prometheus-engine.git
   cd prometheus-engine/examples/scripts/delete_metric_descriptors
   ```
2. dry-run 모드로 매칭 결과를 확인합니다(예: 일관된 prefix 가 없는 디멘션-인-네임 패턴).
   ```bash
   go run ./delete_metric_descriptors.go \
     -project_id=PROJECT_ID \
     -filter='metric.type=starts_with("prometheus.googleapis.com/") AND metric.type=monitoring.regex.full_match(".*_{2,}.*")' \
     -dry_run=true
   ```
3. 결과 목록을 검토하고, 정상 메트릭이 포함되지 않았는지 확인합니다.
4. dry-run 을 해제하고 실제 삭제를 수행합니다.
   ```bash
   go run ./delete_metric_descriptors.go \
     -project_id=PROJECT_ID \
     -filter='metric.type=starts_with("prometheus.googleapis.com/") AND metric.type=monitoring.regex.full_match(".*_{2,}.*")' \
     -dry_run=false
   ```

> [!NOTE]
> **속도 한도:** Cloud Monitoring 은 신규 메트릭 생성, 기존 메트릭에 새 라벨 추가, 그리고 메트릭 삭제 모두에 분당 단위 속도 제한을 적용합니다. 공식 한도값으로 명시된 것은 **디스크립터 생성 6,000건/분/프로젝트** 이며, 삭제 역시 동일 계열의 속도 제한을 받습니다. 수만 건 단위 정리는 자연스럽게 수십 분 단위로 분할 실행되므로, 한 번에 모든 디스크립터를 지우려 하지 말고 prefix 또는 패턴 단위로 청크 분할하여 진행합니다.

### 4.5 REST API 직접 호출 예시

스크립트를 도입하기 전 단건 검증이 필요할 때 사용합니다.

```bash
curl -X DELETE \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://monitoring.googleapis.com/v3/projects/PROJECT_ID/metricDescriptors/prometheus.googleapis.com%2FMETRIC_NAME%2Funknown"
```

`METRIC_TYPE` 의 `/` 는 URL 인코딩(`%2F`) 합니다. `prometheus.googleapis.com/<name>/unknown` 또는 `/unknown:counter` 류는 TYPE 정보 누락으로 이중 수집된 결과이며 우선 정리 대상입니다.

### 4.6 클라이언트 라이브러리 일괄 처리 패턴 (Python)

대규모 정리에서는 정규식 매칭과 dry-run 가드를 갖춘 자체 스크립트가 가장 운영 친화적입니다.

```python
# requirements: google-cloud-monitoring>=2.0
import re
from google.cloud import monitoring_v3

PROJECT_ID = "PROJECT_ID"
PATTERNS = [
    r"^prometheus\.googleapis\.com/.+/unknown(:counter)?$",
    r"^prometheus\.googleapis\.com/.*_{2,}.*$",
    r"^prometheus\.googleapis\.com/.*\d{7,}.*$",
]
DRY_RUN = True

client = monitoring_v3.MetricServiceClient()
project = f"projects/{PROJECT_ID}"
compiled = [re.compile(p) for p in PATTERNS]

candidates = []
for d in client.list_metric_descriptors(name=project):
    if any(rx.match(d.type) for rx in compiled):
        candidates.append(d.name)

print(f"matched: {len(candidates)}")
for name in candidates:
    if DRY_RUN:
        print(f"[dry-run] would delete {name}")
    else:
        client.delete_metric_descriptor(name=name)
        print(f"deleted {name}")
```

운영 시 권장 사항은 다음과 같습니다.

- `DRY_RUN = True` 로 1차 실행하여 전체 후보 수와 샘플 항목을 검토합니다.
- 후보를 외부 파일(CSV)로 export 한 뒤 구성원이 검토하고, 검토 통과 후 `DRY_RUN = False` 로 재실행합니다.
- 분당 6,000건 한도를 넘지 않도록 적절한 sleep 또는 배치 크기 제한을 추가합니다.
- 삭제 직후 약 5~30분 동안은 동일 메트릭의 데이터 포인트가 여전히 유입될 수 있으므로 동일 정규식의 메트릭 제외 규칙(Step 3)을 함께 적용합니다.

## 5. Step 3: 메트릭 제외 규칙으로 신규 수집 차단

### 5.1 제외 규칙의 동작과 한계

메트릭 제외 규칙(Metric exclusion rules)은 *정의된 메트릭에 대한 신규 수집을 거부* 하는 프로젝트 단위 정책입니다. 다음 특성을 정확히 이해한 상태에서 사용해야 합니다.

- 적용 시점: 규칙 생성 후 약 **5분** 후에 효력이 발생합니다.
- 적용 범위: 메트릭의 **출처와 무관**하게(어떤 익스포터와 콜렉터가 보내든) 일치하는 메트릭은 거부됩니다.
- 과거 데이터: **삭제하지 않습니다.** 기존 시계열은 보존된 채 신규 수집만 차단됩니다.
- 비용 영향: 제외된 메트릭은 청구되지 않습니다.
- 단위: 단일 메트릭 또는 정규식으로 그룹화된 다수 메트릭을 한 규칙으로 묶을 수 있습니다. 다중 선택은 UI 상 지원되지 않으므로 대량 차단은 정규식으로 표현합니다.
- 한 메트릭이 어떤 디스크립터에도 매칭되지 않는 정규식과 일치할 경우, Metric exclusion 표에는 `undefined_metric` 으로 표시됩니다.

### 5.2 UI 절차

1. [Metrics Management](https://console.cloud.google.com/monitoring/metrics-management) 페이지에서 **Exclude metric** 버튼을 클릭합니다.
2. 단일 메트릭은 *Metric name* 에서 선택하고, 그룹은 **Regex** 탭으로 전환하여 정규식을 입력합니다.
3. **Show matches** 를 클릭하여 어떤 메트릭이 차단될지 확인합니다.
4. **Create rule** 로 저장합니다.

규칙을 수정하려면 **Excluded Metrics** 탭에서 *Actions → Edit rule* 을 선택합니다. 편집 시 내부적으로는 기존 규칙을 삭제하고 새 규칙을 만들기 때문에, 적용까지 다시 약 5분이 소요됩니다.

### 5.3 안전한 정규식 카탈로그

정상 메트릭에 영향을 주지 않으면서 잘못된 메트릭만 골라 차단하기 위한 공식 권장 패턴입니다. **Show matches** 로 반드시 확인한 후 적용합니다.

| 차단 대상 | 정규식 |
|---|---|
| 연속된 언더스코어 (라벨 파싱 오류로 추정) | `.*_{2,}.*` |
| 7자리 이상 연속 숫자 (타임스탬프 추정) | `.*\d{7,}.*` |
| 매우 긴 영숫자 세그먼트 (라벨 파싱 오류로 추정) | `.*[a-zA-Z0-9]{20,}.*` |
| 16진수/GUID 부분 문자열 | `.*[A-F0-9]{10,}.*` |
| IP 주소 형태 | `.*\d{1,3}_\d{1,3}_\d{1,3}_\d{1,3}.*` |
| TYPE 미상의 Prometheus 메트릭 | `prometheus.googleapis.com/.+/unknown.*` |

특정 익스포터 prefix 를 통째로 차단하고 싶다면 메트릭 이름의 prefix 를 정규식으로 표현해 별도 규칙을 추가합니다. 예를 들어 Cloud Monitoring 의 Metrics Management UI 도움말은 `agent.googleapis.com/apache` 로 시작하는 메트릭을 모두 제외할 때 `agent.googleapis.com/apache.*` 와 같은 정규식을 입력하는 절차를 안내합니다.

> [!TIP]
> **Excluded Metrics** 탭의 *Exclusion timeline* 차트로 차단된 샘플 수와 바이트량의 시계열을 확인할 수 있습니다. 규칙 적용 후 차트가 즉시 우상향하면 효과적이라는 신호이며, 변동이 없다면 정규식이 어떤 메트릭과도 일치하지 않을 가능성이 큽니다.

### 5.4 디스크립터 삭제와의 결합 패턴

권장 시퀀스는 다음과 같습니다.

1. 정규식을 정해 메트릭 제외 규칙을 먼저 생성합니다 (신규 수집 차단).
2. 약 5분 후 동일한 정규식으로 디스크립터 일괄 삭제 스크립트를 dry-run 으로 실행합니다.
3. 삭제 대상이 의도와 일치하면 실제 삭제를 수행합니다.
4. 24~48시간 후 Metrics Management 에서 디스크립터 수가 회복되었는지, 같은 메트릭이 재등록되지 않는지 확인합니다.

## 6. Step 4: 수집 단계에서의 필터링 (Best Practice)

디스크립터 삭제와 메트릭 제외 규칙은 *Cloud Monitoring 수신 측* 의 통제입니다. 근본 원인은 보통 *클러스터 내 콜렉터 측* 에 있으므로, 동일한 정리를 반복하지 않으려면 수집 단계 필터링이 필요합니다.

### 6.1 Keep 액션과 Drop 액션의 선택

> [!NOTE]
> Cost controls 문서는 `keep` 과 `drop` 을 중립적으로 기술합니다(`drop` 은 정규식 일치 메트릭을 제외, `keep` 은 일치 메트릭만 통과). 운영 관점에서는 신규 익스포터와 신규 메트릭이 추가될 때 자동으로 통과되는 `drop` 보다, 명시적으로 허용된 메트릭만 수집하는 `keep` 이 디스크립터 폭증을 구조적으로 더 잘 막는 경향이 있습니다. 환경에 따라 두 방식을 조합해 사용합니다.

### 6.2 PodMonitoring `metricRelabeling` 패턴

GMP 의 관리형 컬렉션(Managed Collection)에서는 `PodMonitoring` 또는 `ClusterPodMonitoring` 리소스의 `metricRelabeling` 필드에서 필터링을 설정합니다.

**Keep 패턴 (권장):**

```yaml
apiVersion: monitoring.googleapis.com/v1
kind: PodMonitoring
metadata:
  name: kube-state-metrics
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: kube-state-metrics
  endpoints:
  - port: http-metrics
    interval: 60s
    metricRelabeling:
    - action: keep
      sourceLabels: [__name__]
      regex: kube_(daemonset|deployment|pod|namespace|node|statefulset|persistentvolume|horizontalpodautoscaler)_.+
```

**Drop 패턴 (보조):**

```yaml
metricRelabeling:
- action: drop
  sourceLabels: [__name__]
  regex: prometheus_target.*|prometheus_sd.*|net_conntrack_.*
```

**Labeldrop 패턴 (특정 라벨 제거):**

```yaml
metricRelabeling:
- action: labeldrop
  regex: ^(label_name_to_drop|another_label)$
```

### 6.3 예약 라벨 보호

> [!WARNING]
> GMP 는 `{project_id, location, cluster, namespace, job, instance}` 라벨 조합으로 시계열을 식별합니다. Troubleshooting 문서는 **이 라벨들, 특히 `job` 과 `instance` 를 `labeldrop` 으로 제거하면 시계열 충돌(collision) 이 자주 발생** 한다고 명시합니다. 별개로, 중계 익스포터(StatsD 등) 에서 `instance` 라벨이 모두 동일 값(예: `localhost`) 으로 덮어써지면 동일 모나크 타깃에 메트릭이 몰려 **"Context deadline exceeded" 503 오류** 의 형태로 카디널리티 오버플로가 발생할 수 있습니다. 두 위험 모두를 피하기 위해 **이 6개 라벨은 relabeling 대상으로 삼지 않습니다.**

### 6.4 스크랩 간격 조정의 효과

스크랩 간격을 늘리면 디스크립터 수에는 영향이 없지만, 시계열 ingestion 비용이 비례하여 줄어듭니다. 디스크립터 정리와 함께 적용하면 비용 절감 효과가 큽니다.

| 변경 전 | 변경 후 | 샘플 수 변화 |
|---|---|---|
| 10초 | 30초 | 약 -66% |
| 10초 | 60초 | 약 -83% |

위 두 비율은 *Managed Service for Prometheus: Cost controls* 문서가 명시한 값입니다. GMP 의 PodMonitoring 에서는 `endpoints[].interval` 필드에서 직접 설정합니다. 환경별로 알림 정확도가 중요한 SLO 메트릭은 짧은 간격을, 그 외 메트릭은 더 긴 간격을 적용해 비용을 줄이는 운영 패턴이 일반적입니다(구체적인 값은 SLO 정의와 관측 요구사항에 따라 결정합니다).

### 6.5 불필요한 ServiceMonitor와 PodMonitoring 비활성화

`kube-prometheus` 패키지는 다수의 ServiceMonitor 를 기본 활성화합니다. GMP 환경에서는 다음 항목 대부분이 불필요합니다.

- `alertmanager`, `prometheus`, `prometheus-adapter`, `prometheus-operator`: GMP 가 대체합니다.
- `kube-apiserver`: 3노드 클러스터 기준 약 200 samples/sec 이며, GKE 메트릭으로 대체 가능합니다.
- `kube-controller-manager`, `kube-scheduler`, `kubelet`: GKE 컨트롤 플레인 메트릭과 중복됩니다.
- `coredns`, `grafana`, `node-exporter`: 사용처가 명확하지 않으면 비활성화합니다.

선별 활성화 후, 남기기로 결정한 ServiceMonitor 에 대해서는 §6.2 의 `keep` 정규식을 적용합니다.

> [!NOTE]
> **자체 배포 컬렉터:** 자체 배포 Prometheus 를 사용한다면 `--export.match='{__name__!="hi_card_a",__name__!="hi_card_b"}'` 플래그로 송신 시점에 필터하거나 recording rule 로 카디널리티를 사전 집계할 수 있습니다. `sample_limit` 도 보조 수단으로 사용 가능하지만 정확한 필터를 선호합니다. 또한 GMP 는 federation 을 공식적으로 지원하지 않습니다. federation 은 `unknown` 타입 메트릭을 만들어 이중 수집을 유발합니다.

## 7. Step 5: 카디널리티 폭증 예방

### 7.1 차원 데이터 모델 준수

가장 중요한 규칙은 **클러스터, 네임스페이스, 요청 경로, 사용자 ID 등 동적 정보는 메트릭 이름이 아니라 라벨 값으로 표현** 하는 것입니다. 이 규칙을 어기는 익스포터는 GMP 환경에서 빠르게 디스크립터 한도를 소진시킵니다.

### 7.2 익스포터별 권장 설정

| 익스포터 | 카디널리티 폭증 원인 | 권장 설정 포인트 |
|---|---|---|
| StatsD 익스포터 | 디멘션을 메트릭 이름에 인코딩 (라벨 사용 미설정 시) | 익스포터 설정에서 디멘션을 라벨로 명시적으로 매핑 |
| Vault 익스포터 | 동적 값이 메트릭 이름에 포함 (예: `path`) | 동적 값을 라벨로 분리하는 익스포터 설정 적용 |
| Envoy / Istio 사이드카 | 클러스터와 메서드 이름이 메트릭 이름에 인코딩 (기본 설정 시) | 익스포터를 라벨 사용 모드로 명시적 구성 |
| 자체 배포 cAdvisor | 컨테이너 라벨과 env var 동적 주입 옵션 활성화 시 | `metricRelabeling` 으로 라벨을 화이트리스트로 제한하거나 동적 옵션 비활성화 |
| kube-state-metrics | 절대 볼륨이 큼 (~900 samples/sec / 3노드) | `keep` 정규식으로 필요한 종류만 통과 |

각 익스포터의 권장 설정 세부 사항은 해당 익스포터의 공식 문서를 함께 참고합니다. Cost controls 와 Troubleshooting 문서는 위 익스포터들을 *카디널리티 폭증 위험군* 으로 명시하지만, 익스포터 별 구체적인 매핑 키와 구성 항목은 각 프로젝트의 익스포터 문서에 위임합니다.

### 7.3 `honor_labels` 와 `instance` 라벨 처리

자체 배포 또는 OpenTelemetry 컬렉터를 사용할 때, 중계 exporter 가 `instance` 라벨을 자기 자신의 IP:Port 로 덮어쓰면 시계열 식별이 깨집니다. Troubleshooting 문서는 다음 두 단계를 함께 권장합니다.

- `instance` 라벨 값을 *익스포터의 IP:Port 또는 이름* 이 아닌 *메트릭을 실제로 생성하는 리소스(예: pod 이름)의 IP:Port 또는 고유 이름* 으로 변경하는 relabeling 규칙을 추가합니다.
- Prometheus 또는 OpenTelemetry 구성에서 `honor_labels` 필드를 `true` 로 설정합니다.

```yaml
metricRelabeling:
- sourceLabels: [__meta_kubernetes_pod_name]
  action: replace
  targetLabel: instance
```

GMP 관리형 컬렉션은 기본적으로 안전한 규칙을 적용하므로 이 가이드는 자체 배포 환경에서 더 중요합니다.

### 7.4 `unknown` 타입 메트릭 이중 수집

> [!WARNING]
> Prometheus 의 `# TYPE` 선언이 누락된 메트릭은 GMP 백엔드(Monarch)가 강타입이므로 **gauge 와 counter 두 번** 수집합니다. 결과적으로 같은 데이터가 `prometheus.googleapis.com/<name>/unknown` 과 `prometheus.googleapis.com/<name>/unknown:counter` 두 디스크립터로 등록되며, 비용과 디스크립터 수가 두 배가 됩니다.
>
> 다음 구성에서 자주 발생합니다.
>
> - Federation 사용 (GMP 는 federation 미지원)
> - Prometheus Remote Write 중계
> - 메트릭 이름을 변경하는 relabeling 규칙
> - `# TYPE` 선언을 빠뜨린 익스포터
>
> 해결 방법은 (1) 위 원인 제거 후 (2) `prometheus.googleapis.com/.+/unknown.*` 패턴으로 메트릭 제외 규칙과 디스크립터 일괄 삭제를 함께 적용하는 것입니다.

## 8. 운영과 거버넌스 권장 사항

### 8.1 분기별 검토 프로세스

1. Metrics Management 에서 Inactive와 Unused billable 메트릭의 추세를 확인합니다.
2. 새로 등록된 디스크립터 중 패턴 의심군(연속 언더스코어, 긴 영숫자, 숫자 시퀀스)을 정규식으로 추출합니다.
3. 신규 익스포터와 신규 ServiceMonitor 도입 시점에 §6.2 keep 정규식을 사전 정의했는지 확인합니다.
4. 정리 후 24~48시간 동안 같은 메트릭이 재등록되지 않는지 확인합니다.

### 8.2 사전 모니터링

디스크립터 사용량은 Cloud Console 의 [Quotas dashboard](https://console.cloud.google.com/iam-admin/quotas) 에서 *Workload, Prometheus, and external metric descriptors per project* 항목으로 확인합니다.

- Quotas dashboard 의 **Notifications** 또는 **Edit Quota** 화면에서 사용량 알림(메일과 SMS) 을 활성화하여 사전 임계치 초과 시 통지를 받도록 구성합니다.
- 정기 검토 주기(예: 분기) 마다 사용률과 신규 등록 추세를 점검합니다.
- 임계치는 환경별 운영 정책에 따라 정합니다. 예를 들어 1차 경고를 70%, 즉시 정리 트리거를 85% 와 같이 설정해 두면 한도 도달 이전 단계에서 인지할 수 있습니다(예시 값이며, 조직 표준에 맞춰 조정합니다).

> [!NOTE]
> Cloud Quotas 가 노출하는 디스크립터 카운트 시계열은 알림 정책(Cloud Monitoring alerting policy) 의 조건 메트릭으로 직접 사용되지 않을 수 있습니다. 알림 정책 기반 자동 통지가 필요하다면 Cloud Quotas 의 사용량 알림 또는 Cloud Logging 감사 이벤트(`MetricService.CreateMetricDescriptor` 등) 기반 로그 기반 메트릭(log-based metric) 을 보조적으로 활용합니다.

> [!NOTE]
> **할당량 상향:** 메트릭 정의가 잘 정돈된 경우에 한해 Workload, Prometheus, External 디스크립터 한도(25,000)를 상향 신청할 수 있습니다. Cloud Console 의 [Quotas dashboard](https://console.cloud.google.com/iam-admin/quotas) 또는 `gcloud alpha services quota list` 를 통해 신청합니다. 정리 작업 없이 상향만 신청하면 거부되거나, 승인되더라도 동일한 폭증이 더 큰 한도까지 반복됩니다.

## 9. 검증 체크리스트

- [ ] 대상 프로젝트의 Metrics Management 페이지에서 Inactive와 Unused billable 메트릭 수가 정리 전 대비 감소했는지 확인
- [ ] 정책 적용 후 약 5분 경과 시점에 Excluded Metrics 탭의 *Exclusion timeline* 차트에서 차단된 샘플 수가 증가하는지 확인
- [ ] PodMonitoring/ClusterPodMonitoring 에 `metricRelabeling`(keep 우선) 이 적용된 매니페스트가 클러스터에 배포되었는지 `kubectl get podmonitoring -A -o yaml` 로 확인
- [ ] 예약 라벨(`project_id`, `location`, `cluster`, `namespace`, `job`, `instance`)에 대한 `labeldrop` 또는 임의 `replace` 규칙이 존재하지 않는지 확인
- [ ] 24~48시간 후 동일 정규식 패턴의 메트릭이 재등록되지 않는지 Metrics Management 에서 재확인
- [ ] "Prometheus metric descriptors" 할당량 사용률이 목표 수준(예: 70% 미만)으로 회복되었는지 모니터링 대시보드에서 확인
- [ ] Cloud Quotas dashboard 의 사용량 알림 또는 보조 알림 채널이 활성화되어 있는지 확인 (임계치는 운영 정책에 따라 결정)

## 10. 참고 문서

- [Cloud Monitoring: Metrics management](https://docs.cloud.google.com/monitoring/docs/metrics-management)
- [Cloud Monitoring: Quotas and limits](https://docs.cloud.google.com/monitoring/quotas)
- [Managed Service for Prometheus: Cost controls](https://docs.cloud.google.com/stackdriver/docs/managed-prometheus/cost-controls)
- [Managed Service for Prometheus: Troubleshooting](https://docs.cloud.google.com/stackdriver/docs/managed-prometheus/troubleshooting)
- [Managed Service for Prometheus: Self-monitoring](https://docs.cloud.google.com/stackdriver/docs/managed-prometheus/exporters/prometheus)
- [Cloud Monitoring API: Naming conventions](https://docs.cloud.google.com/monitoring/api/v3/naming-conventions)
- [Cloud Monitoring API: projects.metricDescriptors.delete](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.metricDescriptors/delete)
- [Cloud Monitoring API: list metric descriptors sample](https://docs.cloud.google.com/monitoring/docs/samples/monitoring-list-descriptors)
- [Cloud Monitoring API: delete metric descriptor sample](https://docs.cloud.google.com/monitoring/docs/samples/monitoring-delete-metric)
- [GoogleCloudPlatform/prometheus-engine: delete_metric_descriptors script](https://github.com/GoogleCloudPlatform/prometheus-engine/blob/main/examples/scripts/delete_metric_descriptors/delete_metric_descriptors.go)
