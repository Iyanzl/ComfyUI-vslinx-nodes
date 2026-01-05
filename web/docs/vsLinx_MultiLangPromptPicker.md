This node helps you build prompts from one or more CSV “prompt lists”. For each row you pick an entry (or choose `Random`), and the node combines everything into one final prompt — plus two preview outputs so you can see what was chosen.

It’s especially useful if you write prompts in another language (Chinese, Japanese, Spanish, etc.) but want the final output to be English prompt text. You can keep a CSV where the **left column is your native-language key** and the **right column is the English prompt text**.

Example CSV (2 columns):
- `猫` → `cat, cute, fluffy`
- `夜景` → `night cityscape, neon lights`

You can then select `猫` inside the node UI (in your language), and the node will output the matching English prompt text.

## How it works
- Click **Select CSV File** to upload one or more CSV files into `ComfyUI/input/csv`.
- Each uploaded CSV becomes an entry in the list inside the node.
- Click the **filename** to quickly switch that row to another CSV that already exists in `input/csv`.
- For each row, choose:
  - `(None)` → ignore this row
  - `Random` → pick a random entry from that CSV (controlled by the node’s seed)
  - Any label from the CSV

## CSV Format
- Only the **first two columns** are used:
  - Column 1 = the key/label you choose in the node (can be your native language)
  - Column 2 = the text that will be added to the final prompt (often English prompt text)
- Rows with an empty key are ignored.
- If the same key appears multiple times, the **last one** is used.

## Parameters
| Parameter | Type | Description |
| -------- | ---- | ----------- |
| Add comma at end? | BOOLEAN | If true and the resulting prompt is not empty, appends a trailing comma. |
| seed | INT | Seed used for `Random` selections when the workflow seed mode is fixed/increment/decrement/randomize. |

## Outputs
| Parameter | Type | Description |
| -------- | ---- | ----------- |
| prompt | STRING | The combined prompt text from all active rows, joined with `", "`. Optionally ends with a comma if enabled. |
| selection_preview | STRING | A multi-line preview of what you selected in each row (including Random picks). |
| output_preview | STRING | A multi-line preview of what each row contributed to the final prompt. |

## Notes
- Only `.csv` files are supported.
- `Random` will pick an entry at runtime using the node’s seed behavior (so results can be stable or change, depending on your workflow seed settings).
- If you upload a CSV that already exists **with the exact same content**, the node will reuse the existing file instead of creating a duplicate.
- If you upload a CSV with the same name but different content, you’ll be asked whether to overwrite, rename, or cancel.
- The filename picker shows all CSV files inside `input/csv`.
- If you try to switch a row to a CSV that is already used by another row, the node avoids duplicates by removing the row you tried to change.
