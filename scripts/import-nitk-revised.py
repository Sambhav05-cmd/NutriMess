"""Extract the supplied revised nutrient sheet, preserving every cell value."""
import csv
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

root = Path(__file__).resolve().parents[1]
source = root / 'nitk_mess_96_foods_revised_realistic_servings.xlsx'
output = root / 'data/nitk-mess-revised-realistic-servings.csv'
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with ZipFile(source) as archive:
    shared = []
    if 'xl/sharedStrings.xml' in archive.namelist():
        shared = [''.join(item.itertext()) for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', ns)]
    records = []
    for row in ET.fromstring(archive.read('xl/worksheets/sheet2.xml')).findall('.//s:sheetData/s:row', ns):
        values = {}
        for cell in row.findall('s:c', ns):
            column = 0
            for char in ''.join(c for c in cell.get('r') if c.isalpha()):
                column = column * 26 + ord(char) - ord('A') + 1
            value = cell.find('s:v', ns)
            if cell.get('t') == 's':
                text = shared[int(value.text)]
            elif cell.get('t') == 'inlineStr':
                text = ''.join(cell.find('s:is', ns).itertext())
            else:
                text = value.text if value is not None else ''
            values[column - 1] = text
        records.append([values.get(i, '') for i in range(48)])
assert records[0][0] == 'menu_item' and len(records) == 97, 'Expected the full 96-food nutrient sheet'
assert len({row[0] for row in records[1:]}) == 96, 'Duplicate foods in revised source'
with (root / 'nitk_mess_96_foods_per_indian_serving.csv').open(encoding='utf-8-sig', newline='') as old:
    assert {row['menu_item'] for row in csv.DictReader(old)} == {row[0] for row in records[1:]}, 'Menu identities changed'
with output.open('w', encoding='utf-8', newline='') as handle:
    csv.writer(handle).writerows(records)
print(f'Imported {len(records)-1} foods into {output.name}')
