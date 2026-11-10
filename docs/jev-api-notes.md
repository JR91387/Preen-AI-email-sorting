# Jev API notes

What we've confirmed about the API Preen uses, and where it came from. Code is written from these documented facts only (clean room).

## Sources (checked 2026-09-30)
- LiteLLM pass-through docs for TypeSafe: https://docs.litellm.ai/docs/pass_through/typesafe
- OpenRouter guide: https://openrouter.ai/docs/guides/community/typesafe-sdk
- MarkTechPost coding guide (SDK behavior): https://www.marktechpost.com/2026/09/23/a-coding-guide-to-typesafe-ai-jev/

## Endpoint
| Provider | URL | Auth |
|---|---|---|
| TypeSafe | `POST https://api.typesafe.ai/v1/systemone` | `Authorization: Bearer <key>` |
| OpenRouter | `POST https://openrouter.ai/api/v1/systemone` | `Authorization: Bearer <OpenRouter key>` |

The request body is identical for both. OpenRouter's response adds `id`, `provider` and `usage.cost`.

## Request
```json
{
  "model": "jev-1.13.0",
  "state": "any text, or a JSON object or array",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": { "billing": "Payments, invoicing, refunds", "technical": "Bugs, outages" }
    },
    "refund": { "type": "noul", "instructions": "Is the customer asking for money back?" }
  }
}
```
- `choice`: up to 255 options, one picked. `criteria` maps each label to its description.
- `score`: `criteria` is an ordered list of levels.
- `noul`: a yes/no question answered as a probability from 0 to 1.
- Instructions may refer to fields inside `state` with backticked paths, e.g. `` `email.subject` ``.

## Response
```json
{
  "model": "jev-1.13.0",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "technical",
      "probabilities": { "billing": 0.08, "technical": 0.85, "sales": 0.07 },
      "confidence": 0.82
    }
  },
  "usage": { "input_tokens": 312, "output_tokens": 48 }
}
```
- Choice `confidence` = `(count × peak − 1) / (count − 1)`, where `peak` is the highest probability.
- **Not yet seen in raw JSON:** the field name for a noul answer. The SDKs expose it as `.noul`. Preen's `readNoul()` accepts `noul`, `probability` or `value` until this is confirmed with a real call.

## Models
- TypeSafe: `jev-1.13.0`, `jev-latest`, `jev-preview`.
- OpenRouter examples use `jev-1.13`. **To confirm** with Test connection.

## Pricing and limits
- As of 2026-09-30: $0.042 per million input tokens; output tokens are free. **Reference only.** Preen has no built-in price, because prices vary by provider and over time. It measures tokens, and shows cost only when the provider reports it (OpenRouter's `usage.cost`) or the user enters a price.
- No streaming.
- Asking several questions in one call uses far fewer tokens than separate calls.
- Documented weak spots: counting, arithmetic, date comparison, and large amounts of irrelevant state.

## Measured with Preen
_To fill in after testing on real mail: average input tokens per email, and cost per 10,000 emails._
