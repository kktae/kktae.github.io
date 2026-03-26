---
title: "Network Intelligence Center와 PSA 모니터링"
date: 2026-03-26
tags: ["GCP", "Network Intelligence Center", "PSA", "Monitoring"]
categories: ["GCP Deep Dive"]
series: ["PSA/PSC Guide"]
series_order: 3
summary: "Network Intelligence Center의 PSA 관련 기능, 서브넷 가시성 제한 사항, 실무 활용 가이드"
---

## 1. Network Intelligence Center 개요

Network Intelligence Center는 Google Cloud의 **통합 네트워크 가시성 플랫폼으로,** 다음 핵심 모듈을 제공합니다: [[1]](#references)

| 모듈 | 기능 |
|------|------|
| **Network Topology** | VPC 네트워크, 하이브리드 연결, GKE 배포를 실시간 메트릭과 함께 시각화 |
| **Connectivity Tests** | 네트워크 엔드포인트 간 연결성을 패킷 포워딩 시뮬레이션 및 라이브 데이터 플레인 분석으로 확인 |
| **Performance Dashboard** | Google Cloud 네트워크 성능 및 프로젝트 리소스 성능 모니터링 |
| **Firewall Insights** | 머신러닝으로 방화벽 규칙 사용을 분석하고 최적화 권장사항 제공 |
| **Network Analyzer** | VPC 네트워크 구성을 자동 모니터링하고 잘못된 구성을 감지 |
| **Flow Analyzer** | 5-tuple 단위로 VPC 트래픽 흐름 분석 |

---

## 2. Network Analyzer의 PSA 모니터링 기능

> 본 섹션은 [[2]](#references) 기반

### 2.1 PSA IP Utilization Insights

Network Analyzer는 **PSA 범위의 IP 주소 사용률 요약 인사이트를** 제공합니다. 이 기능은 2024년 3월부터 사용 가능합니다.

주요 용어:
- **PSA ranges**: Network Analyzer에서 할당된 IP 주소 범위를 지칭
- **PSA subnets**: 서비스 프로듀서가 PSA를 통해 생성한 서브넷을 지칭

### 2.2 Allocation Ratio 추적

Network Analyzer는 PSA 범위의 할당 비율을 추적하며 다음 기준으로 인사이트를 생성합니다:

| 할당 비율 | 인사이트 수준 | 권장 조치 |
|-----------|-------------|-----------|
| **50% 초과** | 정보/권장 | 새로운 할당 IP 범위 추가 검토 |
| **75% 초과** | 경고(Warning) | 즉시 IP 범위 확장 필요 |

> "Review the allocation ratio for your PSA ranges and consider adding new allocated IP address ranges as soon as the allocation ratio is greater than 50%."
> — *IP address utilization insights* [[2]](#references)

### 2.3 모니터링 대상 서비스

Network Analyzer가 PSA IP 사용률을 모니터링하는 서비스: AlloyDB, Cloud SQL, Memorystore, Apigee, Vertex AI

### 2.4 API를 통한 접근

PSA IP 사용률 인사이트는 **Recommender API를** 통해 프로그래밍 방식으로 접근할 수 있습니다:
- Insight 타입: `google.networkanalyzer.vpcnetwork.ipAddressInsight`
- 적절한 IAM 권한이 필요

---

## 3. PSA 서브넷 가시성 관련 논의

### 3.1 알려진 제한 사항

**"PSA가 할당된 서브넷 서비스가 Network Intelligence Center에서 보이지 않는"** 현상에 대해, GCP 공식 문서에서는 다음을 확인할 수 있습니다: [[1]](#references) [[2]](#references)

1. **Network Topology의 범위**: Network Topology는 VPC 네트워크, 하이브리드 연결, GKE 배포를 시각화하지만, **PSA로 생성된 서비스 프로듀서 측 서브넷은 소비자의 VPC에 직접 속하지 않으므로** 소비자 측 Network Topology에서 완전히 표시되지 않을 수 있습니다.

2. **Network Analyzer는 PSA를 지원**: Network Analyzer의 IP Utilization Insights를 통해 PSA 범위와 서브넷의 할당 비율은 확인 가능합니다. 그러나 이는 **IP 사용률 관점의 인사이트이며,** Network Topology와는 별개의 기능입니다.

3. **VPC Peering 기반 가시성**: PSA는 VPC Network Peering을 사용하므로, Peering 네트워크의 리소스 가시성은 Peering 구성과 관련 권한에 따라 달라질 수 있습니다.

### 3.2 Connectivity Tests를 통한 대안 확인

PSA 서브넷이 Network Topology에서 보이지 않는 경우, **Connectivity Tests를** 사용하여 연결 상태를 확인하는 것이 대안이 될 수 있습니다. Connectivity Tests는: [[3]](#references)

- 소스/목적지 엔드포인트 간 연결성을 테스트
- 패킷 포워딩 시뮬레이션과 라이브 데이터 플레인 분석 수행
- 네트워크 경로에서 문제를 식별

---

## 4. 실무 활용 가이드

### 4.1 PSA IP 사용률 모니터링 방법

1. **Google Cloud Console** → Network Intelligence Center → Network Analyzer 접근
2. **IP Utilization** 인사이트 확인
3. PSA Range Level 및 PSA Subnet Level 할당 비율 확인
4. 50% 초과 시 IP 범위 확장 계획 수립

### 4.2 PSA 서비스 연결 확인 방법

1. **Google Cloud Console** → Network Intelligence Center → Connectivity Tests 접근
2. Source: 소비자 VPC의 VM 인스턴스 지정
3. Destination: PSA를 통해 연결된 서비스 인스턴스의 내부 IP 지정
4. 테스트 실행으로 연결 경로 및 상태 확인

### 4.3 권장 모니터링 설정

| 모니터링 항목 | 도구 | 주기 |
|--------------|------|------|
| PSA IP 할당 비율 | Network Analyzer | 상시 (자동) |
| PSA 서비스 연결 상태 | Connectivity Tests | 변경 시 |
| PSA 트래픽 흐름 | Flow Analyzer | 필요 시 |
| 방화벽 규칙 적합성 | Firewall Insights | 주기적 |

---

## 5. 핵심 요약

| 항목 | 내용 |
|------|------|
| PSA IP 모니터링 지원 | Network Analyzer에서 PSA Range/Subnet 할당 비율 추적 가능 |
| 경고 임계값 | 50% → 확장 권장, 75% → 경고 |
| 서브넷 가시성 제한 | PSA 프로듀서 서브넷은 소비자 측 Network Topology에서 완전히 표시되지 않을 수 있음 |
| 대안 도구 | Connectivity Tests로 연결 상태 확인, Network Analyzer로 IP 사용률 확인 |
| 대상 서비스 | AlloyDB, Cloud SQL, Memorystore, Apigee, Vertex AI |

---

## References

| # | 문서 제목 | 링크 |
|---|----------|-----|
| 1 | Network Intelligence Center overview | [바로가기](https://docs.cloud.google.com/network-intelligence-center/docs/overview) |
| 2 | IP address utilization insights - Network Analyzer | [바로가기](https://docs.cloud.google.com/network-intelligence-center/docs/network-analyzer/insights/vpc-network/ip-utilization) |
| 3 | Connectivity Tests overview | [바로가기](https://docs.cloud.google.com/network-intelligence-center/docs/connectivity-tests/concepts/overview) |
| 4 | Network Intelligence Center release notes | [바로가기](https://docs.cloud.google.com/network-intelligence-center/docs/release-notes) |
