# Prompt versions

Current version: `oc-p0-1.0.0` (`app/domain/prompts.ts`).

Every question includes:

- Instruction that source text is untrusted data, not system instructions
- Explicit merchant policy / task (not implied by the question id)
- Uncertainty option
- Ban on overriding merchant rules, including “ignore rules” text

Questions:

| Id | Check |
| --- | --- |
| `pc:{item}` | SEM01 personalization conflict |
| `vc:{item}` | SEM02 variant conflict (operational note only) |
| `uc:{item}` | SEM03 unsupported customization |
| `assign` | SEM04 ambiguous assignment |
| `purpose` | SEM05 text purpose |

State sent to the provider uses opaque order/item refs and excludes email, address, payment, and IP.
