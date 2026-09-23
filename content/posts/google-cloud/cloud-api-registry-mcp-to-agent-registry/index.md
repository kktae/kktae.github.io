---
title: "Cloud API Registry MCP 기능 종료 및 Agent Registry 마이그레이션 가이드"
date: 2026-05-06
summary: "Cloud API Registry MCP 기능 종료에 따른 Agent Registry 마이그레이션 절차와 검증 체크리스트"
tags: ["GCP", "AI Agent", "MCP"]
---
## Executive Summary

- Cloud API Registry 의 Model Context Protocol(MCP) 관련 API, gcloud 명령, ADK 객체, Vertex AI Agent Builder 콘솔의 도구 거버넌스 UI 가 **2026-04-30 부로 deprecated** 되었으며, **2026-07-30 부로 완전히 종료**됩니다.
- 동일한 기능은 신규 서비스인 **Agent Registry (`agentregistry.googleapis.com`)** 로 이관되며, MCP 서버, 도구, AI 에이전트를 한 곳에서 등록, 검색, 거버넌스합니다.
- 종료일 이후 `cloudapiregistry.googleapis.com` 의 `GetMcpServer`, `ListMcpServers`, `GetMcpTool`, `ListMcpTools` RPC 와 `gcloud beta api-registry mcp ...` 명령은 `UNIMPLEMENTED` 또는 `NOT_FOUND` 오류를 반환합니다.
- 콘솔의 도구 거버넌스 UI 는 2026 년 4 월 중순에 자동 전환이 완료되어 별도 작업이 필요 없습니다. 단, **API, gcloud, ADK 호출은 코드 변경이 필요**합니다.

> [!IMPORTANT]
> **조치 필요 (Action Required by 2026-07-30):** Cloud API Registry MCP RPC, `gcloud beta api-registry mcp ...` 명령, API Registry ADK 객체에 의존하는 모든 워크로드를 Agent Registry API, `gcloud alpha agent-registry ...`, Agent Registry ADK 클라이언트로 전환합니다.

## 기술 배경 & 영향도

### 변경 개요

Cloud API Registry 는 Apigee API hub 와 연동되는 API 디스커버리 카탈로그로 출시되었으며, 그 일부로 Google Cloud 서비스의 MCP 서버와 도구를 검색 및 활성화하는 기능을 제공했습니다. 이후 Google Cloud 는 MCP 서버, 도구, AI 에이전트를 통합 관리하는 새로운 거버넌스 계층 **Agent Registry** 를 Gemini Enterprise Agent Platform 의 일부로 출시(Public Preview)하였고, 중복되는 Cloud API Registry 의 MCP 관련 기능을 단계적으로 종료합니다.

Agent Registry 는 다음 세 가지를 단일 카탈로그에서 관리합니다.

- **Agents**: 자율 액터(autonomous actor). A2A(Agent2Agent) 프로토콜 구현체는 자동 수집됩니다.
- **MCP servers**: 표준 MCP 도구와 리소스 제공자. Google Cloud 공식 원격 MCP 서버는 해당 서비스 API 가 활성화된 시점에 자동 등록됩니다.
- **Endpoints**: 에이전트가 호출하는 외부 REST API.

### 영향 범위

다음 요소를 사용하는 워크로드는 종료일 전까지 마이그레이션이 필요합니다.

- `cloudapiregistry.googleapis.com` 서비스의 MCP 관련 RPC 직접 호출 클라이언트 (REST/gRPC)
- `gcloud beta api-registry mcp servers ...`, `gcloud beta api-registry mcp tools ...`, `gcloud beta api-registry mcp enable`, `gcloud beta api-registry mcp disable` 명령을 사용하는 자동화, CI/CD, 운영 스크립트
- API Registry ADK 객체로 작성된 에이전트 코드
- `roles/cloudapiregistry.admin` IAM 권한에 결합된 사용자와 서비스 계정 권한 정책

### 핵심 일정

| 일자 | 이벤트 |
|------|--------|
| 2026-03-27 | Google Cloud MCP 서버 자동 등록 동작 시작 (서비스 API 활성화 시 Agent Registry 에 자동 노출) |
| 2026-04-15 (mid-April) | Vertex AI Agent Builder 콘솔의 도구 거버넌스 UI 가 Agent Registry 기반으로 자동 전환 (사용자 조치 불필요) |
| 2026-04-30 | Cloud API Registry MCP 기능 공식 deprecated |
| 2026-07-30 | Cloud API Registry MCP RPC, gcloud, ADK 객체 종료 (Shutdown) |

### Old → New 매핑

| 항목 | Cloud API Registry (이전) | Agent Registry (신규) |
|------|---------------------------|-----------------------|
| 서비스 엔드포인트 | `cloudapiregistry.googleapis.com` | `agentregistry.googleapis.com` |
| MCP 서버 조회 RPC | `GetMcpServer`, `ListMcpServers` | `Agent Registry API` (Service / McpServer 리소스) |
| MCP 도구 조회 RPC | `GetMcpTool`, `ListMcpTools` | `Agent Registry API` (Service / McpServer 의 Tools 탭) |
| gcloud (조회) | `gcloud beta api-registry mcp servers/tools list \| describe` | `gcloud alpha agent-registry mcp-servers list \| describe` |
| gcloud (활성/비활성) | `gcloud beta api-registry mcp enable \| disable` | 별도 명령 없음: 서비스 API 활성화 시 자동 등록 |
| ADK 객체 | API Registry ADK 객체 | Agent Registry ADK 클라이언트 |
| 콘솔 UI | API Registry 기반 도구 거버넌스 UI | Agent Registry 기반 UI (자동 전환됨) |
| 관리자 IAM 역할 | `roles/cloudapiregistry.admin` | `roles/agentregistry.admin`, `roles/agentregistry.editor`, `roles/agentregistry.viewer` |

> [!WARNING]
> **주의:** `enable` / `disable` 명령에는 1:1 대응되는 신규 명령이 없습니다. 2026-03-27 부터 Google Cloud 의 공식 원격 MCP 서버는 해당 서비스 API 가 프로젝트에서 활성화된 시점에 Agent Registry 에 자동 등록되므로, 별도 활성화 작업이 필요하지 않습니다. 자동화 스크립트에서 이 두 명령을 호출하는 부분은 단순 제거 또는 `gcloud services enable <service>.googleapis.com` 으로 통합합니다.

## 조치 방법 (Action Steps)

### Step 1. Agent Registry API 사전 준비

대상 프로젝트에서 Agent Registry API 를 활성화하고 IAM 역할을 부여합니다. Cloud Shell 또는 최신 gcloud CLI 환경에서 작업하며, alpha 컴포넌트가 필요합니다.

```bash
# alpha 컴포넌트 설치 및 최신화
gcloud components install alpha
gcloud components update

# Agent Registry API 활성화
gcloud services enable agentregistry.googleapis.com \
    --project=PROJECT_ID
```

필요한 IAM 역할은 다음과 같습니다.

- `roles/serviceusage.serviceUsageAdmin`: Agent Registry API 활성화 권한
- `roles/resourcemanager.projectIamAdmin`: 사용자에게 Agent Registry 역할 부여
- `roles/agentregistry.admin`: Agent Registry 리소스 전체 관리
- `roles/agentregistry.editor`: Service 리소스 등록 및 수정
- `roles/agentregistry.viewer`: 에이전트, 도구, MCP 서버 조회

### Step 2. MCP 서버와 도구 조회 호출 마이그레이션

기존 `gcloud beta api-registry mcp ...` 호출을 `gcloud alpha agent-registry ...` 로 교체합니다.

```bash
# 이전 명령 (deprecated, 2026-07-30 이후 실패)
gcloud beta api-registry mcp servers list
gcloud beta api-registry mcp tools list

# 신규 명령
gcloud alpha agent-registry mcp-servers list \
    --project=PROJECT_ID \
    --location=REGION

gcloud alpha agent-registry mcp-servers describe SERVER_NAME \
    --project=PROJECT_ID \
    --location=REGION
```

필터 조건이 있는 자동화 스크립트는 동일한 `--filter` 플래그 형식을 그대로 사용할 수 있습니다.

```bash
gcloud alpha agent-registry mcp-servers list \
    --project=PROJECT_ID \
    --location=REGION \
    --filter="FILTER_EXPRESSION"
```

> [!WARNING]
> **주의:** 신규 명령은 `--location` 플래그가 필수입니다. 수동 등록은 `us`, `eu` 멀티 리전에서는 지원하지 않으므로 지원되는 단일 리전 또는 `global` 위치에 등록해야 합니다.

### Step 3. `enable` / `disable` 호출 제거

`gcloud beta api-registry mcp enable SERVICE` 와 `gcloud beta api-registry mcp disable SERVICE` 호출은 신규 환경에서는 불필요합니다. 다음 두 가지 중 한 가지로 처리합니다.

- **단순 제거**: 자동화에서 호출 라인을 삭제합니다.
- **서비스 API 활성화로 일원화**: MCP 서버 노출 자체가 필요한 경우 `gcloud services enable <service>.googleapis.com --project=PROJECT_ID` 로 해당 서비스를 활성화합니다. 활성화된 서비스의 공식 원격 MCP 서버는 Agent Registry 에 자동 등록됩니다.

```bash
# 이전 (제거 대상)
gcloud beta api-registry mcp enable compute.googleapis.com
gcloud beta api-registry mcp disable compute.googleapis.com

# 신규 (필요한 경우에만)
gcloud services enable compute.googleapis.com \
    --project=PROJECT_ID
```

### Step 4. REST 및 gRPC 클라이언트 마이그레이션

REST/gRPC 클라이언트가 직접 `cloudapiregistry.googleapis.com` 의 RPC 를 호출하는 경우, 호출 대상을 `agentregistry.googleapis.com` 으로 교체합니다.

| 이전 RPC (Cloud API Registry) | 신규 (Agent Registry) |
|-------------------------------|------------------------|
| `GetMcpServer` | Service 리소스의 `McpServer` 조회 (read-only `McpServer` 리소스 사용) |
| `ListMcpServers` | `mcp-servers list` 동등 호출 |
| `GetMcpTool` | MCP server 의 Tools 카탈로그 조회 |
| `ListMcpTools` | MCP server 의 Tools 카탈로그 listing |

Agent Registry API 는 **읽기와 쓰기 리소스가 분리**되어 있다는 점에 주의합니다. 카탈로그 항목의 생성, 수정, 삭제는 쓰기 가능한 `Service` 리소스로, 조회는 읽기 전용 `Agent`, `McpServer`, `Endpoint` 리소스로 수행합니다. 외부 MCP 서버를 직접 등록할 때는 `services create` 명령에 `toolspec.json` 을 함께 전달합니다.

```bash
gcloud alpha agent-registry services create SERVER_NAME \
    --project=PROJECT_ID \
    --location=REGION \
    --display-name="DISPLAY_NAME" \
    --mcp-server-spec-type=tool-spec \
    --mcp-server-spec-content=@toolspec.json \
    --interfaces=url=SERVER_URL,protocolBinding=PROTOCOL
```

### Step 5. ADK 코드 마이그레이션

API Registry ADK 객체로 작성된 에이전트는 Agent Registry ADK 클라이언트로 교체합니다. 종료일까지는 두 라이브러리가 공존하므로 점진적 전환이 가능합니다.

- 도구 디스커버리 로직을 Agent Registry 클라이언트의 MCP 서버와 도구 조회 API 호출로 교체
- 에이전트 등록 및 관리 로직은 자동 등록(Agent Engine, GKE 어노테이션, Workspace 등) 또는 `Service` 리소스 수동 등록으로 분기
- 인증 코드는 Agent Identity (GA) 와 결합해 MCP 서버와 외부 리소스에 대해 에이전트 자체 또는 사용자 위임 인증을 적용

### Step 6. IAM 정책 정리

`roles/cloudapiregistry.admin` 역할이 부여된 주체에 대해 동등한 Agent Registry 역할을 부여하고, 종료일 이후에는 사용되지 않는 이전 역할을 회수합니다.

```bash
# 신규 역할 부여 예시
gcloud projects add-iam-policy-binding PROJECT_ID \
    --member="user:USER_EMAIL" \
    --role="roles/agentregistry.admin"

# 종료일 이후 cleanup
gcloud projects remove-iam-policy-binding PROJECT_ID \
    --member="user:USER_EMAIL" \
    --role="roles/cloudapiregistry.admin"
```

## 검증 체크리스트

- [ ] 대상 프로젝트에서 `agentregistry.googleapis.com` API 가 활성화되어 있습니다.
- [ ] 사용 중인 자동화 및 CI/CD 스크립트에서 `gcloud beta api-registry mcp` 호출이 모두 제거 또는 교체되었습니다.
- [ ] REST/gRPC 클라이언트가 `cloudapiregistry.googleapis.com` 대신 `agentregistry.googleapis.com` 를 호출합니다.
- [ ] API Registry ADK 객체를 사용하는 에이전트 코드가 Agent Registry ADK 클라이언트로 전환되었습니다.
- [ ] `roles/cloudapiregistry.admin` 권한이 부여된 사용자와 서비스 계정에 동등한 `roles/agentregistry.*` 역할이 부여되어 있습니다.
- [ ] `gcloud alpha agent-registry mcp-servers list --project=PROJECT_ID --location=REGION` 으로 기대하는 MCP 서버 목록이 조회됩니다.
- [ ] 외부 MCP 서버를 사용하는 경우 `gcloud alpha agent-registry services create ... --mcp-server-spec-content=@toolspec.json` 로 수동 등록되어 있습니다.
- [ ] Vertex AI Agent Builder 콘솔에서 도구 거버넌스 화면이 Agent Registry 기반으로 정상 표시됩니다.

## 참고 문서

- [Agent Registry overview](https://docs.cloud.google.com/agent-registry/overview)
- [Set up Agent Registry](https://docs.cloud.google.com/agent-registry/setup)
- [Register MCP servers (Agent Registry)](https://docs.cloud.google.com/agent-registry/register-mcp-servers)
- [Manage MCP servers and tools (Agent Registry)](https://docs.cloud.google.com/agent-registry/manage-mcp-tools)
- [Cloud API Registry (Feature deprecations)](https://docs.cloud.google.com/api-registry/docs/deprecations)
- [Cloud API Registry overview](https://docs.cloud.google.com/api-registry/docs/overview)
- [Gemini Enterprise Agent Platform release notes](https://docs.cloud.google.com/gemini-enterprise-agent-platform/release-notes)
- [Gemini Enterprise Agent Platform overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/overview)
