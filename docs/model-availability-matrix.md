# Phase 4.14C — Model Availability Matrix

생성: 2026-04-30T07:08:42.693Z

| provider | model | available | dry_run | latency_ms | error |
|----------|-------|-----------|---------|-----------:|-------|
| ollama | flowscribe/story-qwen:latest | true | ✓ | 5167 |  |
| ollama | flowscribe/story:latest | true | ✓ | 6688 |  |
| ollama | gemma3:12b | true | ✓ | 306 |  |
| ollama | gemma3:27b | true | ✓ | 16285 |  |
| ollama | flowscribe/suggest:latest | true | ✓ | 7865 |  |
| ollama | llama3.1:8b | true | ✓ | 143 |  |
| ollama | qwen2.5:14b | true | ✓ | 6260 |  |
| ollama | gemma4:latest | true | ✓ | 7469 |  |
| ollama | gemma4-fast:latest | true | ✓ | 11384 |  |
| gemini | gemini-2.5-flash | true | ✓ | 1048 |  |
| gemini | gemini-2.5-flash-lite | true | ✓ | 928 |  |
| gemini | gemini-2.0-flash | true | ✗ | 270 | This model models/gemini-2.0-flash is no |
| openai | gpt-4.1-mini | true | ✓ | 1405 |  |
| openai | gpt-4.1 | true | ✓ | 1423 |  |
| openai | gpt-4o-mini | true | ✓ | 1631 |  |
| openai | gpt-4o | true | ✓ | 4846 |  |
| deepseek | deepseek-chat | true | ✓ | 690 |  |
| deepseek | deepseek-reasoner | true | ✗ | 1053 |  |

## 요약
- 총 모델: 18
- dry_run OK: 16
- 실패: 2