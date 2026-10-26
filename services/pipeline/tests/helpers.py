import asyncio
import json
from pathlib import Path
from typing import Any

from candor_pipeline.contracts import AnalysisPayload
from candor_pipeline.providers.base import LLMRequest, LLMResponse, ProviderError, Usage
from candor_pipeline.stages.models import RawClaim

FIXTURE = Path(__file__).parent / "fixtures" / "synthetic_payload.json"
NONCE = "a1b2c3d4e5f60718293a4b5c6d7e8f90"


def payload() -> AnalysisPayload:
    return AnalysisPayload.model_validate_json(FIXTURE.read_bytes())


def raw_claim(**updates: Any) -> RawClaim:
    return RawClaim.model_validate(
        {
            "claim_id": "C001",
            "statement": "PERSON_1 sent the review memo to PERSON_2.",
            "kind": "event",
            "actors": ["PERSON_1"],
            "targets": ["PERSON_2"],
            "action": "sent review memo",
            "time_expression": "15 October 2026",
            "citations": [
                {
                    "passage_id": "D1.P001",
                    "quote": "On 15 October 2026, PERSON_1 sent the review memo to PERSON_2.",
                }
            ],
            "source_type": "document",
            **updates,
        }
    )


class FakeProvider:
    def __init__(self, fail: set[str] | None = None, delay: float = 0) -> None:
        self.requests: list[LLMRequest] = []
        self.fail = fail or set()
        self.delay = delay
        self.active = 0
        self.maximum_active = 0

    async def complete_json(self, request: LLMRequest) -> LLMResponse:
        self.requests.append(request)
        if request.stage in self.fail:
            raise ProviderError("synthetic_failure")
        self.active += 1
        self.maximum_active = max(self.maximum_active, self.active)
        try:
            await asyncio.sleep(self.delay)
            data = self.data(request)
            return LLMResponse(
                data=data,
                text=json.dumps(data),
                provider="synthetic",
                model="deterministic-fixture",
                usage=Usage(input_tokens=10, output_tokens=5),
            )
        finally:
            self.active -= 1

    def data(self, request: LLMRequest) -> dict[str, Any]:
        context = json.loads(
            request.user.split("UNTRUSTED CONTEXT JSON\n")[1].split("\nUNTRUSTED EVIDENCE")[0]
        )
        if request.stage == "extract":
            return {"claims": [raw_claim().model_dump()]}
        if request.stage == "injection_scan":
            return {"findings": []}
        if request.stage == "verify":
            return {
                "verifications": [
                    {
                        "claim_id": claim["claim_id"],
                        "verification": {
                            "verdict": "supported",
                            "rationale": "The memo explicitly records the transfer.",
                            "checked_passages": claim["allowed_passages"],
                            "verifier_model": "",
                        },
                    }
                    for claim in context["claims"]
                ]
            }
        if request.stage == "entities":
            return {"aliases": []}
        if request.stage == "contradictions":
            return {"pairs": []}
        if request.stage == "gaps":
            return {
                "questions": [
                    {
                        "question_id": f"Q{index:03d}",
                        "question": question,
                        "rationale": "Clarifies the sequence of the review.",
                        "gap_type": "evidence",
                        "related_claim_ids": ["C001"],
                        "priority": index,
                        "expected_information_gain": 0.5,
                    }
                    for index, question in enumerate(
                        [
                            "Are there redacted records of the memo's receipt?",
                            "Are there records of the original review schedule?",
                            "What records describe any change to the review date?",
                        ],
                        1,
                    )
                ]
            }
        if request.stage == "brief":
            return {
                "headline": "Review memo timeline",
                "overview": "Records describe a review process.",
                "key_points": ["The memo records a transfer from PERSON_1 to PERSON_2. [C001]"],
                "risk_notes": [],
                "limitations": ["The reason for any delay is not established."],
            }
        raise AssertionError("unexpected_stage")
