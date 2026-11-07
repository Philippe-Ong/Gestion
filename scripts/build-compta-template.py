# Construit templates/compta_template.xlsx (export Comptabilité, v13.6) à partir du
# classeur « Comptabilité SàRL » de l'entreprise (modèle Buchhaltung v2.4).
# Usage : python -I scripts/build-compta-template.py "<classeur>.xlsx" templates/compta_template.xlsx
# Le modèle produit ne contient aucune donnée : écritures, plan comptable, montants,
# créances, dettes et auteurs sont retirés ; formules, styles et feuilles sont gardés.
# Vérifier ensuite le résultat avec le vrai Excel (ouverture via COM).
import sys, re, zipfile

src, dst = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)
names = zin.namelist()
parts = {n: zin.read(n) for n in names}
T = lambda n: parts[n].decode('utf-8')

def col2n(c):
    n = 0
    for ch in c: n = n * 26 + ord(ch) - 64
    return n
def n2col(n):
    s = ''
    while n: n, r = divmod(n - 1, 26); s = chr(65 + r) + s
    return s

CELL = re.compile(r'<c r="([A-Z]+)(\d+)"([^>]*?)(/>|>(.*?)</c>)', re.S)
ROW = re.compile(r'(<row r="(\d+)"[^>]*>)(.*?)</row>|<row r="(\d+)"[^>]*/>', re.S)

def style_of(attrs):
    m = re.search(r'\bs="(\d+)"', attrs)
    return m.group(1) if m else None

def empty(col, row, s):
    return f'<c r="{col}{row}" s="{s}"/>' if s is not None else f'<c r="{col}{row}"/>'

def formula_cell(col, row, s, f):
    sa = f' s="{s}"' if s is not None else ''
    return f'<c r="{col}{row}"{sa}><f>{f}</f></c>'

def strip_cached(cell_xml):
    # cellule à formule : retirer la valeur en cache et son type
    m = CELL.fullmatch(cell_xml)
    if not m or not m.group(5) or '<f' not in m.group(5): return cell_xml
    inner = re.sub(r'<v>.*?</v>|<v/>|<v xml:space="preserve">.*?</v>', '', m.group(5), flags=re.S)
    attrs = re.sub(r'\s+t="\w+"', '', m.group(3))
    return f'<c r="{m.group(1)}{m.group(2)}"{attrs}>{inner}</c>'

def transform(xml, cell_fn=None, row_fn=None):
    """cell_fn(col, row, attrs, inner, original) -> nouveau xml de cellule ou None (inchangé)
       row_fn(row, head, body) -> xml de ligne complet ou None"""
    out = []
    pos = 0
    sd0 = xml.index('<sheetData>') + len('<sheetData>')
    sd1 = xml.index('</sheetData>')
    out.append(xml[:sd0])
    body = xml[sd0:sd1]
    def do_row(m):
        if m.group(4):
            return m.group(0)
        head, r, cells = m.group(1), int(m.group(2)), m.group(3)
        if row_fn:
            res = row_fn(r, head, cells)
            if res is not None: return res
        def do_cell(cm):
            col, row, attrs, inner = cm.group(1), int(cm.group(2)), cm.group(3), cm.group(5)
            res = cell_fn(col, row, attrs, inner, cm.group(0)) if cell_fn else None
            if res is None: res = cm.group(0)
            return strip_cached(res)
        return head + CELL.sub(do_cell, cells) + '</row>'
    out.append(ROW.sub(do_row, body))
    out.append(xml[sd1:])
    return ''.join(out)

sheets = {}

# --- 1. Donnée de base : B7 (entreprise), B8 (siège), B10/D10 (période) -----------
def s1(col, row, attrs, inner, orig):
    if (col, row) in {('B', 7), ('B', 8), ('B', 10), ('D', 10)}:
        return empty(col, row, style_of(attrs))
sheets[1] = transform(T('xl/worksheets/sheet1.xml'), s1)

# --- 2. Plan de compte : C/D/E des emplacements -------------------------------
PLAN_ROWS = set(range(9, 24)) | set(range(25, 43)) | set(range(54, 73)) | set(range(74, 90))
def s2(col, row, attrs, inner, orig):
    if row in PLAN_ROWS and col in ('C', 'D', 'E'):
        return empty(col, row, style_of(attrs))
sheets[2] = transform(T('xl/worksheets/sheet2.xml'), s2)

# --- 3. Bilan d'ouverture : libellés en formules, montants vides --------------
def plan_ref(c, r):
    return f"IF('Plan de Compte'!{c}{r}&lt;&gt;\"\",'Plan de Compte'!{c}{r},\"\")"
def s3(col, row, attrs, inner, orig):
    s = style_of(attrs)
    if 10 <= row <= 24 and col == 'B': return formula_cell(col, row, s, plan_ref('C', row - 1))
    if 10 <= row <= 24 and col == 'C': return formula_cell(col, row, s, plan_ref('D', row - 1))
    if 10 <= row <= 27 and col == 'H': return formula_cell(col, row, s, plan_ref('C', row + 15))
    if 10 <= row <= 27 and col == 'I': return formula_cell(col, row, s, plan_ref('D', row + 15))
    if 10 <= row <= 24 and col == 'E': return empty(col, row, s)
    if 10 <= row <= 27 and col == 'K': return empty(col, row, s)
    if row == 27 and col == 'C': return empty(col, row, s)
sheets[3] = transform(T('xl/worksheets/sheet3.xml'), s3)

# --- 4. Journal : une seule ligne d'écriture, la 12, en prototype -----------------
# L'app recopie ses formules (noms des comptes, grand livre en T) sur les lignes 12 à
# 1619 à chaque export. Pas de formules partagées : Excel refuse le fichier quand une
# formule partagée cite une autre feuille ('Plan de Compte'!…).
j = T('xl/worksheets/sheet4.xml')
m12 = re.search(r'(<row r="12"[^>]*>)(.*?)</row>', j, re.S)
proto = []  # (col, style, formule | None)
for cm in CELL.finditer(m12.group(2)):
    f = re.search(r'<f>(.*?)</f>', cm.group(5) or '', re.S)
    proto.append((cm.group(1), style_of(cm.group(3)), f.group(1) if f else None))
FIXED = {'A': '106', 'B': '97', 'D': '97', 'F': '99', 'G': '107', 'H': '101'}
FIRST, LAST = 12, 1619
def journal_row_plain(r):
    out = [f'<row r="{r}" spans="1:291" ht="12.75" customHeight="1" x14ac:dyDescent="0.25">']
    for col, s, f in proto:
        if col in FIXED: out.append(f'<c r="{col}{r}" s="{FIXED[col]}"/>')
        elif f is None: out.append(empty(col, r, s))
        else: out.append(f'<c r="{col}{r}" s="{s}"><f>{f}</f></c>')
    out.append('</row>')
    return ''.join(out)
def r4(row, head, body):
    if row == FIRST: return journal_row_plain(row)
    if FIRST < row <= LAST: return ''
    return None
sheets[4] = transform(j, None, r4)
sheets[4] = re.sub(r'<sheetView [^>]*>(<selection[^>]*/>)?',
                   '<sheetView tabSelected="1" zoomScale="145" zoomScaleNormal="145" workbookViewId="0"><selection activeCell="A12" sqref="A12"/>',
                   sheets[4], count=1)

# --- 5..7 : formules seules -------------------------------------------------
for i in (5, 6, 7):
    sheets[i] = transform(T(f'xl/worksheets/sheet{i}.xml'))

# --- 8. Créance-client : lignes 7..497 ----------------------------------------
CR_STYLE = {'A': '145', 'B': '138', 'C': '139', 'D': '139', 'E': '139', 'F': '140', 'G': '144',
            'H': '141', 'I': '141', 'J': '138', 'K': '142', 'L': '143'}
def s8(col, row, attrs, inner, orig):
    if not 7 <= row <= 497: return None
    s = CR_STYLE.get(col, style_of(attrs)) if row <= 199 else style_of(attrs)
    if col == 'D': return formula_cell(col, row, s, f'C{row}/107.6*100')
    if col == 'E': return formula_cell(col, row, s, f'C{row}/107.6*7.6')
    if col == 'L': return formula_cell(col, row, s, f'IF(I{row}="",C{row},0)')
    if col == 'F' and row == 200: return None
    if col in 'ABCFGHIJK': return empty(col, row, s)
sheets[8] = transform(T('xl/worksheets/sheet8.xml'), s8)

# --- 9. Dette fournisseur : lignes 9..97 --------------------------------------
DT_STYLE = {'A': '125', 'B': '126', 'C': '127', 'D': '127', 'E': '128', 'F': '128', 'G': '128', 'H': '126', 'I': '126'}
def s9(col, row, attrs, inner, orig):
    if 9 <= row <= 97 and col in DT_STYLE: return empty(col, row, DT_STYLE[col])
sheets[9] = transform(T('xl/worksheets/sheet9.xml'), s9)

# feuille active unique : le Journal
for i in sheets:
    if i != 4: sheets[i] = sheets[i].replace(' tabSelected="1"', '', 1)
    # pas de position de défilement héritée
    sheets[i] = re.sub(r'(<sheetView [^>]*?) topLeftCell="[A-Z]+\d+"', r'\1', sheets[i], count=1)

# --- chaînes partagées : ne garder que celles encore utilisées -----------------
sst = T('xl/sharedStrings.xml')
si_list = re.findall(r'<si>.*?</si>', sst, re.S)
used = []
idx_map = {}
SREF = re.compile(r'(<c r="[A-Z]+\d+"[^>]*\bt="s"[^>]*>)<v>(\d+)</v>')
for i in sheets:
    for m in SREF.finditer(sheets[i]):
        k = int(m.group(2))
        if k not in idx_map:
            idx_map[k] = len(used); used.append(si_list[k])
for i in sheets:
    sheets[i] = SREF.sub(lambda m: f'{m.group(1)}<v>{idx_map[int(m.group(2))]}</v>', sheets[i])
total_refs = sum(len(SREF.findall(sheets[i])) for i in sheets)
head = re.match(r'(.*?<sst [^>]*?)\s+count="\d+"\s+uniqueCount="\d+"(>)', sst, re.S)
new_sst = f'{head.group(1)} count="{total_refs}" uniqueCount="{len(used)}">' + ''.join(used) + '</sst>'

# --- classeur ------------------------------------------------------------------
wb = T('xl/workbook.xml')
wb = re.sub(r'<mc:AlternateContent xmlns:mc="[^"]*"><mc:Choice Requires="x15"><x15ac:absPath [^>]*/></mc:Choice></mc:AlternateContent>', '', wb)
wb = re.sub(r'<calcPr [^>]*/>', '<calcPr calcId="191028" fullCalcOnLoad="1"/>', wb)
wb = re.sub(r'firstSheet="\d+" activeTab="\d+"', 'activeTab="3"', wb)
assert 'absPath' not in wb and 'fullCalcOnLoad' in wb and 'activeTab="3"' in wb

rels = T('xl/_rels/workbook.xml.rels')
rels = re.sub(r'<Relationship Id="rId\d+" Type="[^"]*/(calcChain|customXml)" Target="[^"]*"/>', '', rels)
ct = T('[Content_Types].xml')
ct = re.sub(r'<Override PartName="/(xl/calcChain\.xml|customXml/[^"]*)" ContentType="[^"]*"/>', '', ct)
assert 'calcChain' not in rels + ct and 'customXml' not in rels + ct

core = T('docProps/core.xml')
core = re.sub(r'<dc:creator>[^<]*</dc:creator>', '<dc:creator>ThéCol</dc:creator>', core)
core = re.sub(r'<cp:lastModifiedBy>[^<]*</cp:lastModifiedBy>', '<cp:lastModifiedBy>ThéCol Gestion</cp:lastModifiedBy>', core)

out = {
    '[Content_Types].xml': ct, '_rels/.rels': T('_rels/.rels'), 'docProps/app.xml': T('docProps/app.xml'),
    'docProps/core.xml': core, 'xl/workbook.xml': wb, 'xl/_rels/workbook.xml.rels': rels,
    'xl/theme/theme1.xml': T('xl/theme/theme1.xml'), 'xl/styles.xml': T('xl/styles.xml'),
    'xl/sharedStrings.xml': new_sst,
    'xl/worksheets/_rels/sheet4.xml.rels': T('xl/worksheets/_rels/sheet4.xml.rels'),
}
for i in sheets: out[f'xl/worksheets/sheet{i}.xml'] = sheets[i]
binparts = {'xl/printerSettings/printerSettings1.bin': parts['xl/printerSettings/printerSettings1.bin']}
assert '_rels/.rels' in names
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for n, v in out.items(): z.writestr(n, v.encode('utf-8'))
    for n, v in binparts.items(): z.writestr(n, v)

# --- contrôles -------------------------------------------------------------------
for i in sheets:
    x = sheets[i]
    assert '<v>' not in re.sub(r'<c r="[A-Z]+\d+"[^>]*\bt="s"[^>]*><v>\d+</v>', '', x) or i == 7, f'valeur restante feuille {i}'
    masters = set(re.findall(r'<f t="shared" ref="[^"]+" si="(\d+)"', x))
    kids = set(re.findall(r'<f t="shared" si="(\d+)"/>', x))
    assert kids <= masters, f'formules partagées orphelines feuille {i}: {sorted(kids - masters)[:5]}'
print('ok', {n: len(v) for n, v in out.items() if 'sheet' in n}, 'sst', len(used))
