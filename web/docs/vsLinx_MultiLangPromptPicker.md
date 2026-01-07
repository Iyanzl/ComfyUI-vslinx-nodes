This node helps you build prompts from one or more CSV “prompt lists”. For each row you pick one or more entries (or choose `Random`), and the node combines everything into one final prompt — plus two preview outputs so you can see what was chosen.

It’s especially useful if you write prompts in another language (Chinese, Japanese, Spanish, etc.) but want the final output to be English prompt text. You can keep a CSV where the **left column is your native-language key** and the **right column is the English prompt text**.

Example CSV (2 columns):
- `猫` → `cat, cute, fluffy`
- `夜景` → `night cityscape, neon lights`

You can then select `猫` inside the node UI (in your language), and the node will output the matching English prompt text.

## How it works
- Click **Select CSV File** to upload one or more CSV files into `ComfyUI/input/csv`.
- You can also **organize existing CSVs into subfolders** inside `ComfyUI/input/csv` (e.g. `input/csv/characters/`, `input/csv/styles/`) to structure your prompt libraries.
- Each uploaded CSV becomes a row inside the node.
- Rows can be **freely reordered** by dragging them using the dotted handle on the left.
- Click the **filename** in a row to switch that row to another CSV that already exists in `input/csv` (including subfolders).
- For each CSV row, choose:
  - `(None)` → ignore this row
  - `Random` → pick a random entry from that CSV (controlled by the node’s seed)
  - One or more labels from the CSV (via multi-select)

## Selection & Multi-Select
- Clicking the selection field opens a searchable list of all labels from the first CSV column.
- You can **filter/search** the list to quickly find entries.
- Enable **multi-select mode (⧉-Icon)** to select multiple labels from the same CSV. Lock selection in by clicking the "✓"-Icon that replaces the "⧉"-Icon.
- Selected items are applied **in the order you chose them**, and this order is preserved in the final prompt.
- When multiple labels are selected, the row shows a compact indicator (e.g. “3 selected”), while the full list is visible in the preview outputs.

## Additional Prompt Row
- The node includes an **Additional Prompt** row.
- This lets you insert free-form text (including multi-line prompts) directly into the final prompt.
- The additional prompt behaves like a normal row and can be reordered freely.

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
| seed | INT | Seed used for `Random` selections when the workflow seed mode is fixed / increment / decrement / randomize. |
| pre_text | STRING (input) | Optional text that is prepended to the generated prompt. If both `pre_text` and the generated prompt are present, they are joined with `", "` (or a space if `pre_text` already ends in a comma-like character). |

## Outputs
| Output | Type | Description |
| ----- | ---- | ----------- |
| prompt | STRING | The combined prompt text from all active rows, joined with `", "`. Optionally ends with a comma if enabled. |
| selection_preview | STRING | A multi-line preview showing which labels were selected in each row (including multi-select and Random). |
| output_preview | STRING | A multi-line preview showing what each row contributed to the final prompt text. |

## Notes
- Only `.csv` files are supported.
- CSV files can be stored in subfolders under `input/csv` and will still be discoverable/selectable (e.g. `styles/anime.csv`).
- The file picker supports searching filenames, and can also search **inside CSV contents** (keywords across both columns) via the **In Contents?** toggle.
- `Random` picks are resolved at execution time using the node’s seed behavior.
- If you upload a CSV that already exists **with identical content**, the node reuses the existing file.
- If you upload a CSV with the same name but different content, you’ll be prompted to overwrite, rename, or cancel.
- The file picker lists all CSV files inside `input/csv`.
- If you try to switch a row to a CSV that’s already used by another row, the node avoids duplicates by removing the conflicting row.
- Row order always matters: rows are processed **top to bottom**, exactly as shown in the UI.