---
title: "Gemini Enterprise 개요와 4가지 Agent 유형"
date: 2026-04-14
tags: ["GCP", "Gemini", "Gemini Enterprise", "AI Agent"]
categories: ["GCP Deep Dive"]
series: ["Gemini Enterprise"]
series_order: 1
summary: "Gemini Enterprise의 통합 엔터프라이즈 AI 화면, 4가지 Agent 유형, 그리고 No-Code Agent Builder의 핵심을 슬라이드와 함께 정리"
---

> 풀스크린으로 보기: [/posts/gemini-enterprise/slides/](../slides/)

<iframe
  src="../slides/"
  style="width:100%; aspect-ratio: 16 / 9; border:1px solid rgba(128,128,128,0.3); border-radius:8px; display:block;"
  loading="lazy"
  title="Gemini Enterprise Slides">
</iframe>

---

## 1. 하나의 화면에서 연결되는 엔터프라이즈 AI

Gemini Enterprise는 **대화·검색·생성·분석**을 하나의 화면에서 수행하도록 설계된 Google Cloud의 엔터프라이즈 AI 진입점입니다. 작업에 맞는 모델을 자동으로 선택하고, 사내 데이터 소스에 안전하게 연결되며, Google Workspace·써드파티 SaaS와 네이티브로 통합됩니다.

## 2. 4가지 Agent 유형

| 유형 | 제작 주체 | 특징 |
|------|-----------|------|
| **Google Agents** | Google 제공 | 범용 검색·요약·생성 |
| **Partner Agents** | 파트너사 | Salesforce 등 외부 시스템 연동 |
| **Custom Agents** | 조직 내부 | No-Code Builder로 자연어 설계 |
| **Expert Agents** | 조직 내부 | 전문 도메인 Sub-agent 조합 |

## 3. 세 가지 생산 경로

1. **Pre-built Agents 선택** — Agents Gallery에서 즉시 배포.
2. **No-Code Agent Builder** — 자연어 프롬프트로 Root + Sub-agent 구조 설계, 스케줄 실행까지 GUI에서 완결.
3. **Code-first (ADK / Vertex AI Agent Engine)** — 복잡한 로직·커스텀 툴이 필요할 때.

## 4. 다음 회차 예고

| # | 주제 |
|---|------|
| 02 | No-Code Agent Builder: 자연어 설계, Root + Sub-agent, 스케줄 자동화 |
| 03 | Agents Gallery와 엔터프라이즈 관제: 배포·모니터링·거버넌스 |
| 04 | Custom Agent 프롬프트 설계: 4가지 조건과 Salesforce 실전 예시 |
| 05 | 산업별 활용 사례: 통신 · 리테일·금융 · 헬스케어 |
| 06 | 4단계 도입 프레임워크와 학습 경로 |

상세 내용은 위 슬라이드에서 먼저 확인할 수 있습니다.
