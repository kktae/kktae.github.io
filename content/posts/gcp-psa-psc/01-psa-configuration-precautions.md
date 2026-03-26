---
title: "PSA 구성 시 주의 사항"
date: 2026-03-26
tags: ["GCP", "PSA", "VPC", "Private Service Access"]
categories: ["GCP Deep Dive"]
series: ["PSA/PSC Guide"]
series_order: 1
summary: "Private Service Access(PSA) 구성 시 IP Range 선택, 삭제 순서, Multi-producer 격리 등 반드시 확인할 주의 사항"
---

## 1. PSA 개요

Private Service Access(PSA)는 소비자 VPC 네트워크와 서비스 프로듀서의 VPC 네트워크 간에 **VPC Network Peering** 기반의 프라이빗 연결을 생성하여, Google 관리형 서비스(Cloud SQL, Memorystore, Filestore 등)에 내부 IP로 접근할 수 있게 하는 메커니즘입니다. [[1]](#references)

![PSA Architecture](https://docs.cloud.google.com/static/vpc/images/private-services-access-sql.svg)

---

## 2. IP Range 선택 시 주의 사항

> 본 섹션은 [[2]](#references) 기반

### 2.1 IP 주소 범위 중복 방지

할당할 IP 범위는 현재 사용 중이거나 향후 사용할 서브넷 범위와 **완전히 분리되어야** 합니다. VPC Network Peering으로 연결된 네트워크의 서브넷까지 포함하여 검토해야 합니다.

### 2.2 Docker 및 서드파티 범위 회피

`172.17.0.0/16` 범위는 Docker 및 기타 제품에서 기본적으로 사용하므로 **반드시 회피해야** 합니다. Memorystore, Filestore 등의 서비스에서도 이 범위의 VM에서는 접근이 불가능합니다. [[3]](#references)

### 2.3 Auto Mode 네트워크 제한

Auto Mode VPC 네트워크를 사용하는 경우, `10.128.0.0/9` 범위는 자동 생성 서브넷에 예약되어 있으므로 PSA 할당 범위와 **중복될 수 없습니다**.

### 2.4 Custom Route와의 충돌

할당된 범위와 일치하거나 범위 내에 포함되는 커스텀 정적/동적 라우트가 있으면, 서비스 프로듀서가 사용할 수 있는 주소 공간이 줄어듭니다. 이로 인해 IP 고갈 에러가 발생할 수 있습니다.

> "When a service producer selects an unused portion of an allocated range to use as a candidate for new resources, it excludes all custom route destinations that exactly match or fit within the allocated range."
> — *Configure private services access* [[2]](#references)

---

## 3. Multi-Producer 격리

### 3.1 서비스별 별도 범위 할당 권장

동일한 할당 범위를 여러 서비스 프로듀서에 재사용하지 않아야 합니다. 서비스 프로듀서별로 고유한 할당 범위를 사용하면 라우팅 충돌을 방지하고, 네트워크 설정(라우트, 방화벽 규칙)을 서비스별로 독립적으로 관리할 수 있습니다. [[2]](#references)

---

## 4. 연결 및 접근 제한

> 본 섹션은 [[1]](#references) 기반

### 4.1 단일 Consumer 제한

하나의 서비스 프로듀서 인스턴스에는 **하나의 소비자 VPC 네트워크만** 프라이빗 연결을 생성할 수 있습니다.

### 4.2 비전이성(Non-Transitivity)

프라이빗 연결은 **전이적이지 않습니다**. VPC Network Peering으로 연결된 다른 VPC 네트워크는 해당 프라이빗 연결을 통해 서비스에 접근할 수 없습니다.

### 4.3 보안 책임

PSA를 사용할 때 VPC 네트워크와 그 안의 모든 리소스 및 데이터의 보안은 **소비자가 전적으로 책임집니다.**

> "When you use private services access as a service consumer, you are solely responsible for securing your VPC networks and all resources and data available on them."
> — *Private services access* [[1]](#references)

---

## 5. 범위 수정 및 확장

> 본 섹션은 [[2]](#references) 기반

### 5.1 할당 범위 수정 불가

생성된 할당 범위는 **직접 수정할 수 없습니다**. 확장이 필요한 경우, 기존 범위를 포함하는 연속적인 IP 주소 범위로 확장해야 합니다.

### 5.2 범위 확장 전략

IP가 부족해지면 두 가지 방법으로 대응할 수 있습니다:
1. **기존 범위 확장**: 기존 할당을 포함하는 더 큰 연속 범위로 확장
2. **추가 범위 할당**: 새로운 할당 범위를 프라이빗 연결에 추가

여러 범위를 할당하는 경우, 서비스는 **지정된 순서대로** 각 범위의 IP 주소를 사용합니다.

---

## 6. 삭제 시 주의 사항

> 본 섹션은 [[2]](#references) 기반

### 6.1 범위 삭제 전 서비스 인스턴스 제거 필수

사용 중인 할당 범위를 삭제하기 전에, 해당 범위를 사용하는 **모든 서비스 인스턴스를 먼저 삭제해야** 합니다. 프라이빗 연결에서 범위를 먼저 제거하지 않고 삭제하면 중복 감지가 불가능해져 서비스 프로듀서의 새 서브넷 생성이 차단됩니다.

### 6.2 서브넷 삭제 대기 시간

일부 서비스는 서브넷 삭제 전 대기 기간을 적용합니다. 예를 들어 **Cloud SQL은 마지막 인스턴스 삭제 후 최대 4일이** 지나야 서브넷이 삭제됩니다.

### 6.3 프라이빗 연결 삭제 순서

프라이빗 연결을 삭제하려면:
1. 해당 연결에 의존하는 **모든 서비스 인스턴스를 먼저 삭제**
2. 서브넷 삭제 대기 기간 경과 후
3. 프라이빗 연결 삭제 진행

---

## 7. IP Range 크기 권장 사항

| 항목 | 값 |
|------|-----|
| 최소 크기 | `/24` (256개 주소) |
| 권장 크기 | `/16` (65,536개 주소) |
| 프라이빗 연결당 최대 범위 수 | 5,000개 [[4]](#references) |

여러 리전 또는 데이터베이스 타입에 인스턴스를 생성할 경우, **리전/DB 타입별 최소 `/24` 범위가** 가용해야 합니다. [[2]](#references)

---

## 8. 체크리스트

- [ ] IP 범위가 기존 서브넷, Peering 네트워크 서브넷과 중복되지 않는지 확인
- [ ] `172.17.0.0/16` 범위를 회피했는지 확인
- [ ] Auto Mode VPC의 경우 `10.128.0.0/9` 범위와 중복되지 않는지 확인
- [ ] 커스텀 라우트와 할당 범위의 충돌 여부 확인
- [ ] 서비스 프로듀서별로 별도 할당 범위를 사용하는지 확인
- [ ] 향후 확장을 고려하여 충분한 크기(`/16` 권장)로 할당했는지 확인
- [ ] 삭제 시 의존성 순서를 준수하는지 확인

---

## References

| # | 문서 제목 | 링크 |
|---|----------|-----|
| 1 | Private services access | [바로가기](https://docs.cloud.google.com/vpc/docs/private-services-access) |
| 2 | Configure private services access | [바로가기](https://docs.cloud.google.com/vpc/docs/configure-private-services-access) |
| 3 | Memorystore for Memcached networking | [바로가기](https://docs.cloud.google.com/memorystore/docs/memcached/networking) |
| 4 | Quotas and limits - VPC | [바로가기](https://docs.cloud.google.com/vpc/docs/quota) |
