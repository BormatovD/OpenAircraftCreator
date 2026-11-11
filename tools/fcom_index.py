"""Index supplied FCOM PDFs by page without placing manual text in the repository.

Usage: python3 tools/fcom_index.py --out /tmp/fcom-index manual.pdf [...]
Requires PyMuPDF. Full text and page records belong in a local review directory;
only reviewed provenance and selected numerical data should enter data/fcom.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re

import pymupdf as fitz


TOPICS = {
    "climb": r"\bclimb\b|time.{0,15}fuel.{0,15}distance",
    "cruise_lrc": r"long.range.cruise|\bLRC\b|cruise.*fuel",
    "descent": r"\bdescent\b",
    "holding": r"\bholding\b",
    "systems_loads": r"power.extract|bleed|air.condition|generator|\bkVA\b|\bkW\b",
    "applicability": r"model.identification|aircraft.allocation|list.of.codes|cross.reference|CFM56|RB211|PW20|PW40|GE90",
}


def index_pdf(path: Path, out: Path) -> dict:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", path.stem).strip("-")
    destination = out / f"{slug}-{digest[:8]}"
    destination.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(path)
    pages = []
    topic_pages = {key: [] for key in TOPICS}
    with (destination / "text.txt").open("w", encoding="utf-8") as text_file:
        for i, page in enumerate(doc):
            text = page.get_text(sort=True)
            record = {
                "pdfPage": i + 1,
                "pageLabel": page.get_label(),
                "textCharacters": len(text.strip()),
                "embeddedImages": len(page.get_images()),
                "text": text,
            }
            pages.append(record)
            text_file.write(f"\n===== PDF PAGE {i + 1} =====\n{text}\n")
            for topic, pattern in TOPICS.items():
                if re.search(pattern, text, re.I):
                    topic_pages[topic].append(i + 1)
    summary = {
        "filename": path.name,
        "sha256": digest,
        "bytes": path.stat().st_size,
        "pages": len(doc),
        "pdfMetadata": doc.metadata,
        "pagesWithSubstantialText": sum(p["textCharacters"] >= 200 for p in pages),
        "pagesWithLittleTextAndImages": sum(p["textCharacters"] < 200 and p["embeddedImages"] > 0 for p in pages),
        "topicPagesFromTextLayer": topic_pages,
        "caveat": "Topic matches are navigation aids, not confirmed numerical tables. Raster pages require visual/OCR review.",
    }
    (destination / "pages.json").write_text(json.dumps(pages, ensure_ascii=False) + "\n", encoding="utf-8")
    (destination / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"filename": path.name, "directory": str(destination), "pages": len(doc),
            "pagesWithSubstantialText": summary["pagesWithSubstantialText"],
            "pagesWithLittleTextAndImages": summary["pagesWithLittleTextAndImages"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("pdf", type=Path, nargs="+")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for path in args.pdf:
        print(json.dumps(index_pdf(path, args.out), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
