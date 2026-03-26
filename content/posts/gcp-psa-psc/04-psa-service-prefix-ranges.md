---
title: "PSA 서비스별 Prefix IP Range"
date: 2026-03-26
tags: ["GCP", "PSA", "Cloud SQL", "Memorystore", "Filestore", "AlloyDB"]
categories: ["GCP Deep Dive"]
series: ["PSA/PSC Guide"]
series_order: 4
summary: "Cloud SQL, Memorystore, Filestore, AlloyDB 등 GCP 관리형 서비스별 PSA IP 범위 요구 사항 정리"
---

## 1. 서비스별 요약 테이블

| 서비스 | 최소 블록 크기 | 권장 크기 | 비고 |
|--------|--------------|----------|------|
| **Cloud SQL** | `/24` (리전/DB타입별) | `/16` | 자동 할당 시 `/24` 기본값 |
| **Memorystore Redis** (표준) | `/29` | - | `/24` 이하 prefix로 할당 |
| **Memorystore Redis** (Read Replica) | `/28` | - | `/28`, `/27`, `/26` 지원 |
| **Memorystore Memcached** | `/26` | `/24` 이상 | PSA 필수 (인스턴스 생성 전) |
| **Filestore Basic** | `/29` | - | 한번 지정 시 변경 불가 |
| **Filestore Zonal/Regional/Enterprise** | `/26` | - | 한번 지정 시 변경 불가 |
| **AlloyDB** | `/24` (리전별) | `/16` | 리전별 `/24` 서브넷 생성 |

---

## 2. Cloud SQL (MySQL, PostgreSQL, SQL Server)

> 본 섹션은 [[2]](#references) [[3]](#references) [[4]](#references) 기반

### 2.1 IP Range 요구 사항

- **최소**: `/24` 블록 (256개 주소) — 리전 또는 데이터베이스 타입별
- **권장**: `/16` 블록 (65,536개 주소) — 여러 리전/DB 타입 사용 시
- **자동 할당 기본값**: Google이 `/24` prefix로 `default-ip-range`라는 이름의 범위를 자동 할당

> "If you're going to create instances in multiple regions or for different database types, then you must have a minimum /24 range of IP addresses available for each region or database type."
> — *Configure PSA for Cloud SQL* [[2]](#references)

### 2.2 서브넷 생성 패턴

Cloud SQL은 인프라의 기본 구성 단위로 `/24` 블록을 생성합니다. 리전별로 별도의 서브넷이 필요합니다.

### 2.3 주의 사항

- 프라이빗 연결 생성 후 같은 VPC에서 Cloud SQL, Filestore, Memorystore 등 다른 Google 서비스도 해당 범위를 공유 사용 가능
- Cloud SQL은 **DNS Peering을 지원하지 않음**

---

## 3. Memorystore for Redis

> 본 섹션은 [[5]](#references) 기반

### 3.1 IP Range 요구 사항

| 인스턴스 타입 | 최소 CIDR 블록 |
|--------------|---------------|
| Standard (Read Replica 없음) | `/29` |
| Read Replica 활성화 | `/28` (또는 `/27`, `/26`) |

> "To use the read replicas feature for Memorystore for Redis your instance must have a CIDR IP address range of /28 or greater."
> — *Memorystore for Redis networking* [[5]](#references)

### 3.2 IP 주소 할당 방식

- CIDR prefix는 `/24` 이하여야 함 (더 작은 prefix = 더 큰 IP 범위)
- RFC 1918 프라이빗 IP 주소 지원
- 일부 비 RFC 1918 프라이빗 IP 주소도 지원

### 3.3 제한 사항

- `172.17.0.0/16` 범위의 Compute Engine VM에서는 **접근 불가** (내부 컴포넌트 예약 — [[7]](#references)에 명시, Redis도 동일 제한 적용)
- VPC Network Peering 연결명: `servicenetworking-googleapis-com`

---

## 4. Memorystore for Memcached

> 본 섹션은 [[7]](#references) 기반

### 4.1 IP Range 요구 사항

- **최소**: `/26` 블록
- **권장**: `/24` 이상 — Memcached 및 기타 서비스 지원을 위해

> PSA 구성은 Memcached 인스턴스 생성 전에 **필수로** 완료되어야 합니다.

### 4.2 지원 네트워크 유형

- VPC 네트워크 (Legacy 네트워크 제외)
- Shared VPC 네트워크
- VPN 또는 Interconnect를 통한 온프레미스 시스템
- Compute Engine VM (`172.17.0.0/16` 범위 제외)

### 4.3 IP 주소 관리

각 인스턴스에는 고유 discovery endpoint와 IP 주소가 있으며, 각 노드는 **변경되지 않는 고정 IP 주소를** 부여받습니다.

---

## 5. Filestore

> 본 섹션은 [[8]](#references) [[9]](#references) 기반

### 5.1 IP Range 요구 사항 (인스턴스 타입별)

| 인스턴스 타입 | 블록 크기 | 예시 |
|--------------|----------|------|
| **Basic** | `/29` | `10.123.123.0/29` |
| **Zonal** | `/26` | `172.16.123.0/26` |
| **Regional** | `/26` | `172.16.123.0/26` |
| **Enterprise** | `/26` | `172.16.123.0/26` |

### 5.2 중요 제한 사항

- `172.17.0.0/16` 주소 범위는 **Filestore 내부 컴포넌트에 예약**
  - 이 범위의 클라이언트에서 Filestore 인스턴스에 연결 불가
  - 이 범위 내에서 인스턴스 생성 불가
  - **Private Service Connect 사용 시에는 이 제한이 적용되지 않음**

### 5.3 IP 주소 불변성

> "Once specified, an instance's IP address range is immutable."
> — *Creating Filestore instances* [[8]](#references)

인스턴스 생성 시 지정한 IP 범위는 **변경할 수 없으므로** 신중하게 선택해야 합니다.

### 5.4 할당 옵션

1. **자동 할당** (권장): Filestore가 사용 가능한 IP 범위를 자동 지정
2. **수동 지정**: CIDR 범위를 직접 입력

---

## 6. AlloyDB for PostgreSQL

> 본 섹션은 [[10]](#references) [[11]](#references) 기반

### 6.1 IP Range 요구 사항

- **최소:** `/24` (256개 주소) — 클러스터가 배포된 **리전별**
- **권장**: `/16` (65,536개 주소) — 충분한 주소 공간 확보

### 6.2 서브넷 생성 패턴

AlloyDB는 각 배포 리전에서 `/24` 크기의 리전별 서브넷을 생성합니다. 기존 서브넷이 가득 차면 할당 범위 내에서 **추가 `/24` 서브넷을 자동 생성합니다.** 충분한 공간이 없으면 클러스터 생성이 실패합니다.

### 6.3 주요 제한 사항

- 클러스터 생성 후 PSA 구성을 **변경할 수 없음**

> "You cannot change the private services access configuration of a cluster after AlloyDB has created the cluster."
> — *About PSA for AlloyDB* [[10]](#references)

- **PUPI(Privately Used Public IP) 미지원**: AlloyDB는 PSA에서 PUPI 범위를 지원하지 않음 — PUPI가 필요한 경우 **Private Service Connect** 사용 권장
- RFC 1918 IP 범위만 지원

---

## 7. 일반 PSA IP Range 가이드라인

> 본 섹션은 [[1]](#references) 기반

### 7.1 전체 VPC 수준 권장 크기

| 항목 | 값 |
|------|-----|
| 최소 | `/24` (256개 주소) |
| 권장 | `/16` (65,536개 주소) |

> "For Google services, the minimum size is a single /24 block, but the recommended size is a /16 block."
> — *Configure private services access* [[1]](#references)

### 7.2 공유 IP Range 사용

하나의 PSA 프라이빗 연결을 통해 할당된 범위는 **동일 VPC에서 PSA를 지원하는 모든 Google 서비스가 공유합니다.** Cloud SQL용으로 생성한 프라이빗 연결은 Filestore, Memorystore 등에도 사용됩니다.

### 7.3 IP Range 선택 시 반드시 회피할 범위

| 범위 | 사유 |
|------|------|
| `172.17.0.0/16` | Docker 기본, Memorystore/Filestore 내부 예약 |
| `10.128.0.0/9` | Auto Mode VPC 자동 생성 서브넷 예약 |
| 기존 서브넷/Peering 범위와 중복 | IP 충돌 방지 |

---

## 8. 실무 IP Range 설계 예시

여러 서비스를 사용하는 환경에서의 IP 범위 설계 예시:

```
할당 범위: 10.0.0.0/16 (65,536 주소)

├── Cloud SQL (리전 A): 10.0.0.0/24 ~ 10.0.x.0/24 (자동 할당)
├── Cloud SQL (리전 B): 10.0.y.0/24 ~ (자동 할당)
├── Memorystore Redis: /29 ~ /28 단위 (자동 할당)
├── Memorystore Memcached: /26 단위 (자동 할당)
├── Filestore: /29 또는 /26 단위 (자동 할당)
└── AlloyDB: /24 단위 리전별 (자동 할당)
```

> **주의**: 서비스 프로듀서가 서브넷을 자동 선택하므로, 위 예시의 실제 할당은 프로듀서의 선택에 따라 달라집니다.

---

## References

| # | 문서 제목 | 링크 |
|---|----------|-----|
| 1 | Configure private services access (VPC) | [바로가기](https://docs.cloud.google.com/vpc/docs/configure-private-services-access) |
| 2 | Configure PSA for Cloud SQL (MySQL) | [바로가기](https://docs.cloud.google.com/sql/docs/mysql/configure-private-services-access) |
| 3 | Configure PSA for Cloud SQL (PostgreSQL) | [바로가기](https://docs.cloud.google.com/sql/docs/postgres/configure-private-services-access) |
| 4 | Configure PSA for Cloud SQL (SQL Server) | [바로가기](https://docs.cloud.google.com/sql/docs/sqlserver/configure-private-services-access) |
| 5 | Memorystore for Redis networking | [바로가기](https://docs.cloud.google.com/memorystore/docs/redis/networking) |
| 6 | Establish a connection to Redis | [바로가기](https://docs.cloud.google.com/memorystore/docs/redis/establish-connection) |
| 7 | Memorystore for Memcached networking | [바로가기](https://docs.cloud.google.com/memorystore/docs/memcached/networking) |
| 8 | Creating Filestore instances | [바로가기](https://docs.cloud.google.com/filestore/docs/creating-instances) |
| 9 | Network and IP requirements for Filestore | [바로가기](https://docs.cloud.google.com/filestore/docs/network-ip-requirements) |
| 10 | About PSA for AlloyDB | [바로가기](https://docs.cloud.google.com/alloydb/docs/about-private-services-access) |
| 11 | Configure connectivity for AlloyDB | [바로가기](https://docs.cloud.google.com/alloydb/docs/configure-connectivity) |
