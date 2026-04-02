"""
文件内容提取工具 - 支持 Word, PDF, Excel, TXT 等格式
"""
import os


def extract_text_from_file(filepath: str) -> str:
    """
    从文件中提取纯文本内容。
    支持: .txt, .pdf, .docx, .doc, .xlsx, .xls, .csv, .md
    """
    ext = os.path.splitext(filepath)[1].lower()

    try:
        if ext in ('.txt', '.md', '.csv', '.log'):
            return _read_text_file(filepath)
        elif ext == '.pdf':
            return _read_pdf(filepath)
        elif ext in ('.docx',):
            return _read_docx(filepath)
        elif ext in ('.xlsx', '.xls'):
            return _read_excel(filepath)
        else:
            return f"[不支持的文件格式: {ext}]"
    except Exception as e:
        return f"[文件解析失败: {str(e)}]"


def _read_text_file(filepath: str) -> str:
    """读取纯文本文件，自动检测编码"""
    try:
        import chardet
        with open(filepath, 'rb') as f:
            raw = f.read()
        detected = chardet.detect(raw)
        encoding = detected.get('encoding', 'utf-8') or 'utf-8'
        return raw.decode(encoding, errors='replace')
    except ImportError:
        # chardet 不可用时尝试常见编码
        for enc in ('utf-8', 'gbk', 'gb2312', 'latin-1'):
            try:
                with open(filepath, 'r', encoding=enc) as f:
                    return f.read()
            except (UnicodeDecodeError, LookupError):
                continue
        return "[文本文件编码无法识别]"


def _read_pdf(filepath: str) -> str:
    """读取 PDF 文件"""
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(filepath)
        pages = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text()
            if text and text.strip():
                pages.append(f"--- 第{i+1}页 ---\n{text.strip()}")
        return "\n\n".join(pages) if pages else "[PDF 无可提取文本（可能是扫描件）]"
    except ImportError:
        return "[需要安装 PyPDF2: pip install PyPDF2]"


def _read_docx(filepath: str) -> str:
    """读取 Word (.docx) 文件"""
    try:
        from docx import Document
        doc = Document(filepath)
        paragraphs = []
        for para in doc.paragraphs:
            text = para.text.strip()
            if text:
                paragraphs.append(text)

        # 也读取表格
        for table in doc.tables:
            rows = []
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                rows.append(" | ".join(cells))
            if rows:
                paragraphs.append("\n[表格]\n" + "\n".join(rows))

        return "\n".join(paragraphs) if paragraphs else "[Word 文档内容为空]"
    except ImportError:
        return "[需要安装 python-docx: pip install python-docx]"


def _read_excel(filepath: str) -> str:
    """读取 Excel 文件"""
    try:
        from openpyxl import load_workbook
        wb = load_workbook(filepath, read_only=True, data_only=True)
        sheets_text = []

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows = []
            for row in ws.iter_rows(values_only=True):
                cells = [str(c) if c is not None else '' for c in row]
                if any(cells):  # 跳过全空行
                    rows.append(" | ".join(cells))
            if rows:
                sheets_text.append(f"[工作表: {sheet_name}]\n" + "\n".join(rows))

        wb.close()
        return "\n\n".join(sheets_text) if sheets_text else "[Excel 文件内容为空]"
    except ImportError:
        return "[需要安装 openpyxl: pip install openpyxl]"


# 支持的文件扩展名
SUPPORTED_EXTENSIONS = {'.txt', '.md', '.csv', '.log', '.pdf', '.docx', '.xlsx', '.xls'}


def is_supported(filename: str) -> bool:
    """检查文件是否支持解析"""
    ext = os.path.splitext(filename)[1].lower()
    return ext in SUPPORTED_EXTENSIONS
