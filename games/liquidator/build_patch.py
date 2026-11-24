"""Builds patch.json from the translation table: only the Ukrainian strings, the new letters (drawn here)
and the checksums of the jar it fits. No text, images or code of the game go into it.
   build_patch.py <translation.tsv> > patch.json"""
import csv, json, sys

tr = {}
for row in csv.reader(open(sys.argv[1], encoding='utf-8-sig'), delimiter='\t'):
    if len(row) >= 4 and ':' in row[0] and row[3] != '':
        tr[row[0]] = row[3]
tr.setdefault('st:15:1', 'Рівень ')

# Help lines with the buttons of Lilka (offered as an option: a phone keeps its own keys)
lilka_help = {
    'HELP:3:1': '(ВЛІВО)-Рух ліворуч', 'HELP:4:1': '(ВПРАВО)-Рух праворуч', 'HELP:5:1': '(ВГОРУ)-Стрибок',
    'HELP:6:1': '(ВНИЗ)-Присісти', 'HELP:7:1': '(B)-Вогонь (граната)', 'HELP:8:1': '(A)-Вогонь (кулемет)',
    'HELP:9:1': '(D)-Виклик меню', 'HELP:10:1': '(C)-Перегляд мапи',
}

# Є Ї Ґ take the places of Э Ъ Ы (Ukrainian has none of them): the text is written with those bytes and
# the font entries 93/90/91 point at the new glyphs, drawn under the old ones. І is the Latin I.
# Big font: '#' outline, '.' fill, ' ' clear. Small font: 'x' stroke.
glyphs = {
    'fnt': {'palette': {'#': [0, 0, 0], '.': [255, 255, 0]}, 'table': 'cf', 'glyphs': {
        '93': ['#######', '#.....#', '#..####', '#..### ', '#....# ', '#..### ', '#..####', '#.....#', '#######'],
        '90': ['##  ##', '      ', ' #### ', ' #..# ', ' #..# ', ' #..# ', ' #..# ', ' #..# ', ' #### '],
        '91': ['    ###', '#####.#', '#.....#', '#..####', '#..#   ', '#..#   ', '#..#   ', '#..#   ', '####   '],
    }},
    'fnt2': {'palette': {'x': [255, 255, 255]}, 'table': 'cf2', 'glyphs': {
        '93': [' xxx', 'x   ', 'xxx ', 'x   ', 'x   ', ' xxx'],
        '90': ['x x', '   ', 'xxx', ' x ', ' x ', ' x ', ' x ', 'xxx'],
        '91': ['   x', 'xxxx', 'x   ', 'x   ', 'x   ', 'x   ', 'x   '],
    }},
}

files = {}
for k, v in tr.items():
    f, line, field = k.split(':')
    files.setdefault(f, {})['%s:%s' % (line, field)] = v
help_lilka = {}
for k, v in lilka_help.items():
    f, line, field = k.split(':')
    help_lilka['%s:%s' % (line, field)] = v

patch = {
    'kind': 'netlizard-text',
    'name': 'Ліквідатор — український переклад',
    'version': '1.0',
    'game': 'Liquidator (NET Lizard, 2006), 240x320 Samsung',
    # CRC32 of the files of the jar this patch was made for
    'crc': {'e.class': 0xca7172e3, 'a.class': 0x15265ac0, 'b.class': 0x1935cc1e, 'st.png': 0xa824e614,
            'tlk.png': 0x22a56680, 'HELP.png': 0x0cc8ffc1, 'CREDITS.png': 0x97a6b4ad, 'fnt.png': 0xcdcc8fc8,
            'fnt2.png': 0xa2c5960d, 'cf.png': 0x079696aa, 'cf2.png': 0x492bc005},
    'text': files,
    'helpLilka': help_lilka,
    'remap': {'Є': 0xDD, 'є': 0xDD, 'Ї': 0xDA, 'ї': 0xDA, 'Ґ': 0xDB, 'ґ': 0xDB, 'І': 0x49, 'і': 0x49,
              '—': 0x2D, '–': 0x2D, '’': 0x27, 'ʼ': 0x27, '«': 0x22, '»': 0x22},
    'fonts': glyphs,
}
json.dump(patch, sys.stdout, ensure_ascii=False, indent=1)
