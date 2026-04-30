# LLM Agent Routing Inventory (Phase 4.12)

생성: 2026-04-30T05:23:55.520Z

## 요약
- 총 호출 파일: **34**
- routeable: **14**
- non-routeable (audit/script): 20

## Task Type 분포
- UNKNOWN: 18
- READER_IMMERSION_JUDGE: 4
- SUGGESTION_LIGHT: 3
- POSTPROCESS_REPAIR: 3
- PLANNER_LONG_CONTEXT: 2
- RENDERER_CREATIVE: 1
- MEMORY_SUMMARY: 1
- FORESHADOW_REASONING: 1
- ITEM_DESCRIPTION: 1

## 파일별 inventory

| file | agent_id | task_type | routeable | patterns |
|------|----------|-----------|-----------|----------|
| `scripts/audit_action_affordance.mjs` | action_affordance_judge | READER_IMMERSION_JUDGE | true | generateContent×1, generativelanguage×1, GEMINI_API_KEY×2 |
| `scripts/audit_knowledge_boundaries.mjs` | knowledge_boundary_judge | READER_IMMERSION_JUDGE | true | generateContent×1, generativelanguage×1, GEMINI_API_KEY×2 |
| `scripts/audit_story_quality_with_gemini.mjs` | script:audit_story_quality_with_gemini | UNKNOWN | false | generateContent×1, generativelanguage×1, GEMINI_API_KEY×2 |
| `scripts/benchmarks/planner_sample_runner.ts` | planner | PLANNER_LONG_CONTEXT | true | getLLMClient×1, chat.completions×1, getStoryModel×1 |
| `scripts/benchmarks/test_runner.ts` | script:test_runner | UNKNOWN | false | getLLMClient×2, chat.completions×2, getStoryModel×2 |
| `scripts/debug_suggest_item_detail.mjs` | script:debug_suggest_item_detail | SUGGESTION_LIGHT | false | generateContent×1, generativelanguage×1, GEMINI_API_KEY×4 |
| `scripts/diagnostics/ab_hook_world_runner.ts` | script:ab_hook_world_runner | UNKNOWN | false | getLLMClient×1, chat.completions×1, getStoryModel×1 |
| `scripts/diagnostics/ab_state_persistence_runner.ts` | script:ab_state_persistence_runner | UNKNOWN | false | getLLMClient×1, chat.completions×1, getStoryModel×1 |
| `scripts/diagnostics/gen_validate.ts` | script:gen_validate | UNKNOWN | false | getLLMClient×2, chat.completions×2, getStoryModel×2 |
| `scripts/diagnostics/pov_diag_runner.ts` | script:pov_diag_runner | UNKNOWN | false | getLLMClient×1, chat.completions×1, getStoryModel×1 |
| `scripts/diagnostics/protagonist_diag_runner.ts` | script:protagonist_diag_runner | UNKNOWN | false | getLLMClient×1, chat.completions×1, getStoryModel×1 |
| `scripts/experiments/multi_book_validate.mjs` | script:multi_book_validate | UNKNOWN | false | chat.completions×1 |
| `scripts/gemini_audit_raw.mjs` | script:gemini_audit_raw | UNKNOWN | false | generateContent×1, generativelanguage×1, GEMINI_API_KEY×1 |
| `scripts/gemini_reader_immersion_audit.mjs` | reader_immersion_judge_gemini | READER_IMMERSION_JUDGE | true | generateContent×1, generativelanguage×1, GEMINI_API_KEY×2 |
| `scripts/gemini_reader_immersion_full_audit.mjs` | reader_immersion_judge_gemini | READER_IMMERSION_JUDGE | true | generateContent×1, generativelanguage×1, GEMINI_API_KEY×2 |
| `scripts/gemini_short_audit.mjs` | script:gemini_short_audit | UNKNOWN | false | generateContent×1, generativelanguage×1, GEMINI_API_KEY×1 |
| `scripts/inventory_llm_agents.mjs` | script:inventory_llm_agents | UNKNOWN | false | generateContent×2, GEMINI_API_KEY×2, OPENAI_API_KEY×2, DEEPSEEK_API_KEY×2 |
| `scripts/verify_ai_suggest.mjs` | script:verify_ai_suggest | SUGGESTION_LIGHT | false | GEMINI_API_KEY×1 |
| `scripts/verify_narrative_coherence_repair.mjs` | script:verify_narrative_coherence_repair | POSTPROCESS_REPAIR | false | generativelanguage×3 |
| `src/api/episodes.ts` | unknown:episodes | UNKNOWN | false | getLLMClient×1, chat.completions×1, getSummaryModel×1 |
| `src/api/suggest.ts` | suggestion (multiple sub-agents) | SUGGESTION_LIGHT | true | getLLMClient×2, chat.completions×2, generateContent×1, generativelanguage×1, GEMINI_API_KEY×2, getSuggestModel×2 |
| `src/lib/llm.ts` | unknown:llm | UNKNOWN | false | getLLMClient×1, generativelanguage×1, GEMINI_API_KEY×1, OPENAI_API_KEY×1, DEEPSEEK_API_KEY×1, getStoryModel×3, getPlannerModel×3, getRendererModel×1, getSuggestModel×3, getSummaryModel×3 |
| `src/pipeline/index.ts` | unknown:index | UNKNOWN | false | getPlannerModel×1 |
| `src/pipeline/planner.ts` | planner | PLANNER_LONG_CONTEXT | true | getLLMClient×1, chat.completions×1, getPlannerModel×1 |
| `src/pipeline/renderer.ts` | renderer | RENDERER_CREATIVE | true | getLLMClient×1, chat.completions×1, getRendererModel×1 |
| `src/services/arc_memory.ts` | arc_summary_writer | MEMORY_SUMMARY | true | getLLMClient×2, chat.completions×2, getSummaryModel×2 |
| `src/services/foreshadow.ts` | foreshadow_extractor + foreshadow_resolver | FORESHADOW_REASONING | true | getLLMClient×1, chat.completions×1, getSummaryModel×1 |
| `src/services/item_desc.ts` | item_description_generator | ITEM_DESCRIPTION | true | getLLMClient×1, chat.completions×1, getSuggestModel×1 |
| `src/services/narrative_coherence.ts` | narrative_repair_judge | POSTPROCESS_REPAIR | true | generateContent×1, generativelanguage×1, GEMINI_API_KEY×2 |
| `src/services/revision.ts` | post_revision | UNKNOWN | true | getLLMClient×1, chat.completions×1, getStoryModel×1 |
| `src/services/story.ts` | unknown:story | UNKNOWN | false | getLLMClient×1, chat.completions×1, getStoryModel×2 |
| `src/services/validator.ts` | post_validator | POSTPROCESS_REPAIR | true | chat.completions×1, DEEPSEEK_API_KEY×2 |
| `src/training/ending_reward.ts` | unknown:ending_reward | UNKNOWN | false | chat.completions×1, DEEPSEEK_API_KEY×2 |
| `src/training/model_registry.ts` | unknown:model_registry | UNKNOWN | false | getStoryModel×4, getSummaryModel×1 |