"""Extract supplied INDB workbooks without editing them or requiring Excel libraries."""
import hashlib
import json
from pathlib import Path
import re
import os
import tempfile
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def records(filename):
    with ZipFile(filename) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        rows = []
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        for row in sheet.findall(".//m:sheetData/m:row", NS):
            values = {}
            for cell in row.findall("m:c", NS):
                value = cell.find("m:v", NS)
                inline = cell.find("m:is", NS)
                text = value.text if value is not None else "".join(inline.itertext()) if inline is not None else ""
                if cell.get("t") == "s" and text:
                    text = strings[int(text)]
                if text:
                    values[re.sub(r"\d+", "", cell.get("r"))] = text.strip()
            if values:
                rows.append(values)
        headers = rows[0]
        return [{headers[key]: value for key, value in row.items() if key in headers} for row in rows[1:]]


def extract():
    repo = ROOT / "Indian-Nutrient-Databank-INDB-"
    workbook = ROOT / "Anuvaad_INDB_2024.11.xlsx"
    sources = [workbook, *(repo / name for name in ["recipes.xlsx", "UK_fct.xlsx", "US_fct.xlsx"])]
    snapshot = {
        "formatVersion": 1,
        "extractorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "source": "Indian Nutrient Databank (INDB), supplied November 2024 workbook",
        "sourceUrl": "https://www.anuvaad.org.in/indian-nutrient-databank/",
        "files": [{"path": p.relative_to(ROOT).as_posix(), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in sources],
        "recipes": records(workbook),
        "recipeIngredients": [r for r in records(repo / "recipes.xlsx") if r.get("recipe_code")],
        "ingredients": [r for name in ["UK_fct.xlsx", "US_fct.xlsx"] for r in records(repo / name) if r.get("food_code")],
    }
    output = ROOT / ".data" / "indb-source.json"
    output.parent.mkdir(exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent, delete=False) as temporary:
        temporary.write(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n")
        temporary_name = temporary.name
    os.replace(temporary_name, output)
    print(f"Extracted {len(snapshot['recipes'])} recipes and {len(snapshot['ingredients'])} ingredient references.")


if __name__ == "__main__":
    extract()
