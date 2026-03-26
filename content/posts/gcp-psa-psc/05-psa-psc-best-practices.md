---
title: "PSA vs PSC Best Practice"
date: 2026-03-26
tags: ["GCP", "PSA", "PSC", "Private Service Connect", "Best Practice"]
categories: ["GCP Deep Dive"]
series: ["PSA/PSC Guide"]
series_order: 5
summary: "PSA와 PSC를 어떻게 구분하여 사용하는지에 대한 Best Practice — 의사결정 플로우 포함"
---

## 1. PSA vs PSC 핵심 차이

| 항목 | PSA (Private Service Access) | PSC (Private Service Connect) |
|------|----------------------------|------------------------------|
| **연결 방식** | VPC Network Peering | Endpoint/Backend (Peering 불필요) |
| **IP 관리** | 소비자가 IP 범위를 할당 | 소비자의 기존 내부 IP 사용 |
| **전이성** | 비전이적 (Peered VPC로 확장 불가) | 전이적 연결 가능 (Network Attachment 통해) |
| **스케일링** | Peering 기반 공유 스케일링 의존성 | 독립적 스케일링 |
| **접근 제어** | 네트워크 수준 | 서비스 단위 세밀한 제어 |
| **IP 조정** | 소비자-프로듀서 간 IP 조정 필요 | IP 조정 부담 없음 |

> [[1]](#references)

---

## 2. Google의 PSC 권장 이유

> "Private Service Connect is a popular option because it provides an alternative to peering that eliminates shared scaling dependencies, improves security, and reduces IP coordination between the producer and consumer of a managed service."
> — *Private access options for services* [[1]](#references)

PSC의 주요 장점:
1. **공유 스케일링 의존성 제거**: VPC Peering의 제약 없음
2. **보안 향상**: 서비스 단위 세밀한 접근 제어
3. **IP 조정 부담 감소**: 프로듀서와 소비자 간 IP 범위 조정 불필요
4. **서비스 지향 접근**: 소비자와 프로듀서 간 세밀한 서비스 접근 제어

---

## 3. 서비스별 지원 현황 비교

### 3.1 양쪽 모두 지원하는 서비스

다음 서비스들은 PSA와 PSC를 모두 지원하므로, 요구 사항에 따라 선택할 수 있습니다: [[1]](#references)

- **Cloud SQL** (MySQL, PostgreSQL, SQL Server)
- **Filestore**
- **Memorystore**
- **AlloyDB for PostgreSQL**

### 3.2 PSC 전용 사용 사례

- **Google APIs 접근** (googleapis.com 등): PSC가 주요 옵션
- **VPC에 호스팅된 커스텀 서비스**: Published Service 형태로 PSC 전용 설계
- **소비자 관리 로드밸런서를 통한 엔드포인트 접근**: PSC만 지원

---

## 4. 사용 시나리오별 권장 사항

### 4.1 PSC를 권장하는 시나리오

| 시나리오 | 이유 |
|---------|------|
| 여러 VPC/프로젝트/조직에서 서비스 접근 필요 | PSC는 Peering 없이 다중 VPC 연결 가능 |
| 엔드포인트별 세밀한 인가 필요 | PSC는 per-endpoint authorization 제공 |
| 글로벌 서비스 + 멀티 리전 접근 | PSC Global Access로 리전 간 접근 가능 |
| 하이브리드 아키텍처 (온프레미스 + 클라우드) | VPN/Interconnect 통합이 PSC와 잘 작동 |
| 양방향 연결 필요 (consumer ↔ producer) | PSC Interface를 통한 bidirectional connectivity |
| VPC Peering 제약 회피 필요 | PSC는 Peering의 비전이성, 스케일링 제약 없음 |
| PUPI(Privately Used Public IP) 사용 필요 | AlloyDB 등에서 PSA는 PUPI 미지원, PSC는 지원 |

> [[3]](#references)

### 4.2 PSA가 적절한 시나리오

| 시나리오 | 이유 |
|---------|------|
| 단순한 아키텍처 + 소수 VPC | VPC Peering 기반의 간단한 구성 |
| 기존 PSA 환경이 안정적으로 운영 중 | 불필요한 마이그레이션 회피 |
| PSC를 아직 지원하지 않는 서비스 | 서비스 지원 여부 확인 필수 |

> [[1]](#references)

---

## 5. PSC 배포 패턴 (Deployment Patterns)

Google Cloud 공식 문서에서 정의하는 PSC 배포 패턴: [[3]](#references)

| 패턴 | 설명 | 아키텍처 다이어그램 |
|------|------|-------------------|
| **Single-Tenant** | 전용 서비스 인스턴스 + consumer accept list로 선택적 접근 | ![Single-Tenant](https://docs.cloud.google.com/static/vpc/images/psc-single-tenant.svg) |
| **Multi-Tenant** | 하나의 서비스에 여러 소비자 접근 + 연결 제한 및 PROXY protocol | ![Multi-Tenant](https://docs.cloud.google.com/static/vpc/images/psc-multi-tenant.svg) |
| **Multi-Region** | Global Access로 모든 리전에서 endpoint 접근 | ![Multi-Region](https://docs.cloud.google.com/static/vpc/images/psc-multi-region.svg) |
| **Hybrid/On-Premises** | VPN/Interconnect 통합으로 크로스 프레미스 연결 | ![Hybrid Access](https://docs.cloud.google.com/static/vpc/images/hybrid-access.svg) |
| **Bidirectional** | PSC Interface를 통한 프로듀서→소비자 방향 연결 | ![Reverse PSC](https://docs.cloud.google.com/static/vpc/images/psc-reverse.svg) |
| **Hybrid Services** | 하이브리드 서비스 아키텍처 | ![Hybrid](https://docs.cloud.google.com/static/vpc/images/psc-hybrid.svg) |
| **Shared VPC** | Host/Service 프로젝트 전반에 endpoint, backend, attachment 배포 | ![Shared VPC](https://docs.cloud.google.com/static/vpc/images/psc-shared-vpc.svg) |

---

## 6. 마이그레이션 고려 사항 (PSA → PSC)

### 6.1 양쪽 모두 지원하는 서비스의 경우

Cloud SQL, Filestore 등 양쪽 모두 지원하는 서비스의 경우, 점진적으로 PSC로 전환하는 것이 가능합니다. PSC를 사용하면 여러 VPC에서 같은 서비스에 접근할 수 있어 유연성이 높아집니다. [[1]](#references)

### 6.2 고려해야 할 사항

- 서비스별 PSC 지원 여부를 반드시 확인
- 외부 IP 주소 제거 가능 여부
- 기존 PSA 범위와의 공존 가능 여부

---

## 7. 의사결정 플로우차트

```
[서비스가 PSC를 지원하는가?]
    ├── No → PSA 사용
    └── Yes
        ├── [여러 VPC/프로젝트에서 접근 필요?]
        │   └── Yes → PSC 사용
        ├── [세밀한 엔드포인트별 접근 제어 필요?]
        │   └── Yes → PSC 사용
        ├── [VPC Peering 제약이 문제인가?]
        │   └── Yes → PSC 사용
        ├── [PUPI IP 범위 사용 필요?]
        │   └── Yes → PSC 사용
        └── [기존 PSA 환경이 안정적 + 단순 아키텍처?]
            └── Yes → PSA 유지 가능 (향후 PSC 전환 권장)
```

---

## 8. 핵심 요약

| 항목 | PSA | PSC |
|------|-----|-----|
| 최적 사용 시점 | 단순 아키텍처, 기존 환경 유지 | 복잡한 멀티 VPC/조직, 세밀한 제어 필요 |
| Google 권장 방향 | 기존 호환성 유지 | **현대적 대안으로 적극 권장** |
| IP 관리 부담 | 높음 (범위 할당/관리) | 낮음 (기존 내부 IP 사용) |
| 확장성 | VPC Peering 제약 존재 | 독립적 스케일링 |

---

## References

| # | 문서 제목 | 링크 |
|---|----------|-----|
| 1 | Private access options for services | [바로가기](https://docs.cloud.google.com/vpc/docs/private-access-options) |
| 2 | Private Service Connect | [바로가기](https://docs.cloud.google.com/vpc/docs/private-service-connect) |
| 3 | Private Service Connect deployment patterns | [바로가기](https://docs.cloud.google.com/vpc/docs/private-service-connect-deployments) |
| 4 | Private Service Connect compatibility | [바로가기](https://docs.cloud.google.com/vpc/docs/private-service-connect-compatibility) |
| 5 | About PSA for AlloyDB | [바로가기](https://docs.cloud.google.com/alloydb/docs/about-private-services-access) |
