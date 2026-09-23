---
title: "Google Cloud Shielded VM Microsoft Secure Boot 인증서 만료 대응 가이드"
date: 2026-05-07
summary: "Microsoft Secure Boot 2011 인증서 만료에 대비한 Shielded VM 스냅샷 재생성 절차"
tags: ["GCP", "Compute Engine", "Security", "Shielded VM"]
---
## Executive Summary

- Microsoft 가 발급한 Secure Boot 신뢰 체인의 핵심 인증서 3종(KEK CA 2011 / UEFI CA 2011 / Windows Production PCA 2011) 이 2026년 6월부터 10월 사이 순차적으로 만료됩니다.
- 영향 범위는 **2025년 11월 7일 이전에 생성**된 Compute Engine Shielded VM 가운데 Secure Boot 가 활성화된 인스턴스, vTPM PCR 봉인을 사용하는 인스턴스, BitLocker와 FDE 등 디스크 암호화를 적용한 인스턴스입니다.
- Google 의 **현시점 권장 조치는 인증서 수동 업데이트가 아닌 "스냅샷 기반 인스턴스 재생성"** 입니다. 새 인스턴스에는 2023 인증서가 자동으로 포함됩니다.
- Container-Optimized OS(COS) 인스턴스, 자체 PK/KEK 사용 인스턴스, 2025년 11월 7일 이후 생성 인스턴스는 영향을 받지 않습니다.

> [!IMPORTANT]
> **조치 필요 (Action Required by 2026-06-24):** Secure Boot 가 활성화된 2025년 11월 7일 이전 생성 인스턴스를 식별하고, 디스크 스냅샷을 통해 신규 인스턴스로 재생성합니다. KEK CA 2011 만료(2026-06-24) 이후에는 DB와 DBX 업데이트가 불가능하므로 이 일정을 1차 마감으로 삼습니다.

## 기술 배경

### Secure Boot 와 Microsoft 인증서

UEFI Secure Boot 는 부팅 시 펌웨어가 부트로더, 커널, 드라이버 등 부팅 바이너리의 디지털 서명을 신뢰 저장소(`db`, `KEK`)와 대조하여 신뢰된 코드만 실행하도록 보장하는 산업 표준입니다. Shielded VM 의 UEFI 펌웨어에는 Microsoft 가 2011년 발급한 인증서 일부가 기본 신뢰 저장소에 포함되어 있습니다.

Microsoft 는 이 2011 시리즈 인증서들을 2023년 발급한 후속 인증서로 교체 중이며, 2026년부터 2011 인증서가 순차 만료됩니다. 신규 부트로더, shim, 커널은 점차 **2023 인증서로만 서명**되므로, 2023 인증서를 신뢰하지 않는 시스템은 펌웨어와 보안 업데이트를 더 이상 적용할 수 없게 됩니다.

### 인증서 만료 일정

| 만료 인증서 | 역할 | 저장 위치 | 만료일 | 후속 인증서 |
|---|---|---|---|---|
| Microsoft Corporation KEK CA 2011 | DB와 DBX 업데이트 서명 | KEK | 2026-06-24 | Microsoft Corporation KEK 2K CA 2023 |
| Microsoft Corporation UEFI CA 2011 | 서드파티 부트로더(Linux Shim 등) 서명 | DB | 2026-06-27 | Microsoft UEFI CA 2023 |
| Microsoft Windows Production PCA 2011 | Windows 부트로더 서명 | DB | 2026-10-19 | Windows UEFI CA 2023 |

KEK 가 가장 먼저 만료되며, KEK 만료 후에는 DB와 DBX 자체를 갱신할 수 없으므로 **2026-06-24 가 사실상의 1차 데드라인** 입니다.

### 영향 범위

영향을 받는 워크로드:

- 2025-11-07 이전에 생성된 Linux와 Windows Shielded VM 가운데 Secure Boot 가 활성화된 인스턴스
- vTPM Platform Configuration Register(PCR) 를 사용한 비밀 봉인(secret sealing) 적용 인스턴스
- Windows BitLocker와 Virtual Secure Mode(VSM)를 사용하는 Windows 인스턴스
- Linux Full Disk Encryption(FDE) 적용 인스턴스
- 2025-11-07 이전 머신 이미지로 롤백한 인스턴스

영향을 받지 않는 워크로드:

- 2025-11-07 이후에 생성된 인스턴스 (Google Cloud 가 2023 인증서를 자동 포함)
- Secure Boot 미활성, vTPM PCR 봉인 미사용, 디스크 암호화 미사용 인스턴스
- Container-Optimized OS(COS) 기반 인스턴스 (Secure Boot 에 별도 인증서 사용, 2026년 만료 대상 아님)
- 자체 Platform Key(PK) 또는 Key Enrollment Key(KEK) 를 제공해 운영하는 인스턴스

조치를 취하지 않을 경우 잠재적 영향:

- **Windows**: 시스템 이벤트 로그에 Event ID 1801("Secure Boot CA/keys need to be updated") 발생, 신규 커널과 부트로더 보안 업데이트 적용 불가
- **Linux**: 새 인증서가 없는 상태에서 shim 업데이트만 적용되는 드문 경우 부팅 실패 가능성

## 조치 방법 (Action Steps)

> [!WARNING]
> **주의:** Google 은 현시점에 **DB 또는 KEK 인증서를 수동으로 업그레이드하지 말 것** 을 명시적으로 권장합니다. 머신 이미지, 인스턴스 클론, Backup and DR Service 는 펌웨어를 함께 복제해 기존 2011 인증서가 그대로 남으므로 마이그레이션 수단으로 사용할 수 없습니다. **표준 디스크 스냅샷 → 신규 인스턴스 생성** 만이 권장 마이그레이션 경로입니다.

### Step 1. 영향 인스턴스 식별

Secure Boot 가 활성화된 채 2025-11-07 이전에 생성된 모든 Compute Engine 인스턴스를 식별합니다.

```bash
gcloud compute instances list \
  --filter="creationTimestamp < '2025-11-07' AND shieldedInstanceConfig.enableSecureBoot=true" \
  --format="table(
    name,
    zone,
    creationTimestamp,
    shieldedInstanceConfig.enableSecureBoot:label=SECURE_BOOT,
    shieldedInstanceConfig.enableIntegrityMonitoring:label=INTEGRITY_MONITORING
  )"
```

조직 단위 점검은 `gcloud asset search-all-resources` 또는 Cloud Asset Inventory export 후 BigQuery 조회로 확장합니다.

### Step 2. 부팅 자산과 복구 키 점검

마이그레이션 또는 향후 수동 업데이트 절차 적용 전, 데이터 가용성을 확보합니다.

- Full Disk Encryption(FDE)와 BitLocker 사용 시 **복구 키를 즉시 사용 가능**한 위치(예: Secret Manager, KMS, 운영팀 보안 보관소)에 보관 확인
- 모든 영향 인스턴스의 부트 디스크와 데이터 디스크에 대해 최근 스냅샷 또는 백업 보유 확인
- 레거시 커스텀 이미지를 식별하고, 사용 중단하거나 2023 인증서가 포함된 새 베이스 이미지로 재빌드 계획 수립

### Step 3. 디스크 스냅샷 기반 인스턴스 재생성

권장 마이그레이션 절차입니다. 스냅샷은 디스크의 블록 단위 복사본이며 UEFI 변수나 인스턴스 단위 메타데이터를 포함하지 않으므로, 스냅샷으로부터 새로 만든 인스턴스의 펌웨어에는 2023 인증서가 정상적으로 포함됩니다.

```bash
# 1) 부트 디스크 스냅샷 생성
gcloud compute disks snapshot SOURCE_DISK_NAME \
  --snapshot-names=SOURCE_DISK_NAME-pre-secureboot-migration \
  --zone=ZONE

# 2) 스냅샷으로부터 새 부트 디스크 생성
gcloud compute disks create NEW_DISK_NAME \
  --source-snapshot=SOURCE_DISK_NAME-pre-secureboot-migration \
  --zone=ZONE \
  --type=pd-ssd

# 3) 새 부트 디스크로 신규 Shielded VM 생성 (Secure Boot 유지)
gcloud compute instances create NEW_INSTANCE_NAME \
  --zone=ZONE \
  --machine-type=MACHINE_TYPE \
  --disk=name=NEW_DISK_NAME,boot=yes,auto-delete=yes \
  --shielded-secure-boot \
  --shielded-vtpm \
  --shielded-integrity-monitoring
```

> [!WARNING]
> **주의:** 머신 이미지(Machine Image), 인스턴스 클론(Clone), Backup and DR Service 는 인스턴스 펌웨어 자체를 복제하므로 원본의 2011 인증서가 그대로 새 인스턴스에 남습니다. 본 마이그레이션 목적으로는 사용할 수 없습니다.

### Step 4. 검증: 새 인증서 존재 확인

새 인스턴스가 2023 인증서를 가지고 있는지 OS 별로 검증합니다.

**Linux** (Debian/Ubuntu/RHEL/SLES 공통, `efitools` 필요):

```bash
# Debian/Ubuntu
sudo apt update && sudo apt install -y efitools
# RHEL/CentOS/Fedora
sudo yum install -y efitools
# SLES
sudo zypper install -y efitools

# KEK 와 db 의 2023 인증서 존재 확인 (두 명령 모두 매칭이 출력되어야 함)
sudo efi-readvar -v KEK | grep "KEK 2K CA 2023"
sudo efi-readvar -v db  | grep "UEFI CA 2023"
```

**Windows** (관리자 PowerShell):

```powershell
# KEK 에서 Microsoft KEK 2K CA 2023 확인: True 반환 기대
[System.Text.Encoding]::ASCII.GetString((Get-SecureBootUEFI KEK).bytes) `
  -match 'Microsoft Corporation KEK 2K CA 2023'

# db 에서 UEFI CA 2023 확인: True 반환 기대
[System.Text.Encoding]::ASCII.GetString((Get-SecureBootUEFI db).bytes) `
  -match 'UEFI CA 2023'

# Secure Boot 활성 상태 확인
Confirm-SecureBootUEFI
```

### Step 5. 부팅 실패 시 임시 복구 절차

2026년 6월 이후 Secure Boot 위반으로 인스턴스가 부팅에 실패할 경우 임시 복구 옵션입니다.

```bash
# Secure Boot 임시 비활성화: 인스턴스를 부팅시켜 OS, 부트 컴포넌트 업데이트 수행
gcloud compute instances update INSTANCE_NAME --no-shielded-secure-boot

# 업데이트 적용 후 Secure Boot 재활성화
gcloud compute instances update INSTANCE_NAME --shielded-secure-boot
```

> [!WARNING]
> **주의:** Secure Boot 를 비활성화하면 PCR7 값이 변경되므로 vTPM 비밀 봉인이나 디스크 암호화 기능이 영향을 받을 수 있습니다. BitLocker와 FDE 사용 인스턴스는 사전에 복구 키를 확보한 뒤 진행합니다. 영구 복구 수단으로는 백업 머신 이미지로부터 복구하거나 스냅샷 기반으로 인스턴스를 재생성합니다.

## 검증 체크리스트

- [ ] 조직 내 모든 프로젝트에서 Secure Boot 활성화 + 2025-11-07 이전 생성 인스턴스 목록 확보
- [ ] FDE와 BitLocker 사용 인스턴스의 복구 키 보관 위치와 접근 가능성 확인
- [ ] 부트 디스크와 데이터 디스크 최근 스냅샷 보유 확인
- [ ] 레거시 커스텀 이미지 식별 및 신규 베이스 이미지 기반 재빌드 계획 수립
- [ ] 마이그레이션 대상 인스턴스 재생성 후 Linux `efi-readvar` / Windows `Get-SecureBootUEFI` 로 2023 인증서 존재 확인
- [ ] vTPM PCR 봉인 의존 워크로드(예: Linux LUKS PCR 바인딩) 의 봉인 정책 재구성 또는 재키잉 수행
- [ ] 변경 후 부팅과 통합성 모니터링 로그(Cloud Logging `compute.googleapis.com/shielded_vm_integrity`) 정상 확인

## 참고 문서

- [Microsoft Secure Boot certificates expiration guide (Compute Engine)](https://docs.cloud.google.com/compute/docs/security/ms-secure-boot-certificates-expiration)
- [Windows Secure Boot certificate expiration and CA updates (Microsoft Support, KB 5062710)](https://support.microsoft.com/en-us/topic/windows-secure-boot-certificate-expiration-and-ca-updates-7ff40d33-95dc-4c3c-8725-a9b95457578e)
- [Modify Shielded VM options (Compute Engine)](https://cloud.google.com/compute/docs/instances/modifying-shielded-vm)
- [Secure Boot (Compute Engine)](https://cloud.google.com/compute/shielded-vm/docs/modifying-shielded-vm)
- [Create snapshots of a Persistent Disk (Compute Engine)](https://cloud.google.com/compute/docs/disks/create-snapshots)
