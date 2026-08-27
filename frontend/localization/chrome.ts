import type { ApplicationLocale } from '@/contracts/locale'

export const FRONTEND_CHROME_KEYS = [
  'skipToContent', 'primaryNavigation', 'languageNavigation', 'breadcrumbNavigation', 'footerNavigation', 'footerUnavailable',
  'searchPrompts', 'explore', 'outputs', 'useCases', 'styles', 'techniques', 'featured', 'trending', 'tasks', 'cameraMotion',
  'models', 'collections', 'creators', 'subjects', 'subjectBand', 'residualState', 'related', 'topPrompts', 'allPrompts',
  'facets', 'variables', 'evidence', 'faq', 'previousPage', 'nextPage', 'identity', 'outcome', 'prompt', 'inputs',
  'parameters', 'examples', 'workflow', 'variations', 'sourceSignals', 'actions', 'required', 'optional', 'relatedDestinations',
] as const

export type FrontendChromeKey = typeof FRONTEND_CHROME_KEYS[number]
export type FrontendChrome = Readonly<Record<FrontendChromeKey, string>>

const row = (...values: readonly string[]): FrontendChrome => {
  if (values.length !== FRONTEND_CHROME_KEYS.length) throw new Error('frontend chrome locale row is incomplete')
  return Object.freeze(Object.fromEntries(FRONTEND_CHROME_KEYS.map((key, index) => [key, values[index]!])) as Record<FrontendChromeKey, string>)
}

const en = row(
  'Skip to content', 'Primary navigation', 'Language', 'Breadcrumb', 'Footer', 'Footer navigation unavailable.',
  'Search prompts', 'Explore', 'Outputs', 'Use cases', 'Styles', 'Techniques', 'Featured', 'Trending', 'Tasks', 'Camera & Motion',
  'Models', 'Collections', 'Creators', 'Subjects', 'Subject band', 'Residual state', 'Related', 'Top prompts', 'All prompts',
  'Facets', 'Variables', 'Evidence', 'FAQ', 'Previous page', 'Next page', 'Identity', 'Outcome', 'Prompt', 'Inputs',
  'Parameters', 'Examples', 'Workflow', 'Variations', 'Source + Signals', 'Actions', 'Required', 'Optional', 'Related destinations',
)
const zhCN = row(
  '跳到正文', '主导航', '语言', '面包屑导航', '页脚', '暂无页脚导航。',
  '搜索提示词', '探索', '输出类型', '使用场景', '风格', '技法', '精选', '趋势', '任务', '镜头与运动',
  '模型', '合集', '创作者', '主题', '主题分组', '其余状态', '相关内容', '热门提示词', '全部提示词',
  '筛选条件', '变量', '证据', '常见问题', '上一页', '下一页', '基本信息', '生成效果', '提示词', '输入',
  '参数', '示例', '工作流', '变体', '来源与信号', '操作', '必填', '可选', '相关页面',
)
const zhTW = row(
  '跳至正文', '主要導覽', '語言', '麵包屑導覽', '頁尾', '目前沒有頁尾導覽。',
  '搜尋提示詞', '探索', '輸出類型', '使用情境', '風格', '技法', '精選', '趨勢', '任務', '鏡頭與動態',
  '模型', '合集', '創作者', '主題', '主題分組', '其他狀態', '相關內容', '熱門提示詞', '全部提示詞',
  '篩選條件', '變數', '證據', '常見問題', '上一頁', '下一頁', '基本資訊', '生成效果', '提示詞', '輸入',
  '參數', '範例', '工作流程', '變體', '來源與訊號', '操作', '必填', '選填', '相關頁面',
)
const ja = row(
  '本文へ移動', 'メインナビゲーション', '言語', 'パンくずリスト', 'フッター', 'フッターナビゲーションはありません。',
  'プロンプトを検索', '探す', '出力', '用途', 'スタイル', 'テクニック', 'おすすめ', 'トレンド', 'タスク', 'カメラと動き',
  'モデル', 'コレクション', 'クリエイター', '主題', '主題グループ', 'その他の状態', '関連', '人気のプロンプト', 'すべてのプロンプト',
  '絞り込み', '変数', 'エビデンス', 'よくある質問', '前のページ', '次のページ', '基本情報', '結果', 'プロンプト', '入力',
  'パラメーター', '例', 'ワークフロー', 'バリエーション', '出典とシグナル', '操作', '必須', '任意', '関連ページ',
)
const ko = row(
  '본문으로 이동', '기본 탐색', '언어', '이동 경로', '바닥글', '바닥글 탐색을 사용할 수 없습니다.',
  '프롬프트 검색', '탐색', '출력', '사용 사례', '스타일', '기법', '추천', '트렌드', '작업', '카메라 및 모션',
  '모델', '컬렉션', '크리에이터', '주제', '주제 그룹', '기타 상태', '관련 항목', '인기 프롬프트', '모든 프롬프트',
  '필터', '변수', '근거', '자주 묻는 질문', '이전 페이지', '다음 페이지', '기본 정보', '결과', '프롬프트', '입력',
  '매개변수', '예시', '워크플로', '변형', '출처 및 신호', '작업', '필수', '선택', '관련 페이지',
)
const de = row(
  'Zum Inhalt springen', 'Hauptnavigation', 'Sprache', 'Brotkrümelnavigation', 'Fußzeile', 'Keine Fußzeilennavigation verfügbar.',
  'Prompts suchen', 'Entdecken', 'Ausgaben', 'Anwendungsfälle', 'Stile', 'Techniken', 'Empfohlen', 'Im Trend', 'Aufgaben', 'Kamera & Bewegung',
  'Modelle', 'Sammlungen', 'Ersteller', 'Motive', 'Motivgruppe', 'Restzustand', 'Verwandt', 'Top-Prompts', 'Alle Prompts',
  'Filter', 'Variablen', 'Nachweise', 'FAQ', 'Vorherige Seite', 'Nächste Seite', 'Identität', 'Ergebnis', 'Prompt', 'Eingaben',
  'Parameter', 'Beispiele', 'Arbeitsablauf', 'Variationen', 'Quelle + Signale', 'Aktionen', 'Erforderlich', 'Optional', 'Verwandte Seiten',
)
const fr = row(
  'Aller au contenu', 'Navigation principale', 'Langue', 'Fil d’Ariane', 'Pied de page', 'Navigation de pied de page indisponible.',
  'Rechercher des prompts', 'Explorer', 'Sorties', 'Cas d’usage', 'Styles', 'Techniques', 'À la une', 'Tendances', 'Tâches', 'Caméra et mouvement',
  'Modèles', 'Collections', 'Créateurs', 'Sujets', 'Groupe de sujets', 'État résiduel', 'Contenu associé', 'Meilleurs prompts', 'Tous les prompts',
  'Filtres', 'Variables', 'Preuves', 'FAQ', 'Page précédente', 'Page suivante', 'Identité', 'Résultat', 'Prompt', 'Entrées',
  'Paramètres', 'Exemples', 'Flux de travail', 'Variations', 'Source + signaux', 'Actions', 'Requis', 'Facultatif', 'Pages associées',
)
const it = row(
  'Vai al contenuto', 'Navigazione principale', 'Lingua', 'Percorso di navigazione', 'Piè di pagina', 'Navigazione del piè di pagina non disponibile.',
  'Cerca prompt', 'Esplora', 'Output', 'Casi d’uso', 'Stili', 'Tecniche', 'In evidenza', 'Di tendenza', 'Attività', 'Camera e movimento',
  'Modelli', 'Raccolte', 'Creator', 'Soggetti', 'Gruppo soggetti', 'Stato residuo', 'Correlati', 'Prompt migliori', 'Tutti i prompt',
  'Filtri', 'Variabili', 'Prove', 'FAQ', 'Pagina precedente', 'Pagina successiva', 'Identità', 'Risultato', 'Prompt', 'Input',
  'Parametri', 'Esempi', 'Flusso di lavoro', 'Variazioni', 'Fonte + segnali', 'Azioni', 'Obbligatorio', 'Facoltativo', 'Pagine correlate',
)
const es = row(
  'Saltar al contenido', 'Navegación principal', 'Idioma', 'Migas de pan', 'Pie de página', 'Navegación del pie no disponible.',
  'Buscar prompts', 'Explorar', 'Resultados', 'Casos de uso', 'Estilos', 'Técnicas', 'Destacados', 'Tendencias', 'Tareas', 'Cámara y movimiento',
  'Modelos', 'Colecciones', 'Creadores', 'Temas', 'Grupo de temas', 'Estado residual', 'Relacionado', 'Mejores prompts', 'Todos los prompts',
  'Filtros', 'Variables', 'Evidencia', 'Preguntas frecuentes', 'Página anterior', 'Página siguiente', 'Identidad', 'Resultado', 'Prompt', 'Entradas',
  'Parámetros', 'Ejemplos', 'Flujo de trabajo', 'Variaciones', 'Fuente + señales', 'Acciones', 'Obligatorio', 'Opcional', 'Páginas relacionadas',
)
const pt = row(
  'Saltar para o conteúdo', 'Navegação principal', 'Idioma', 'Navegação estrutural', 'Rodapé', 'Navegação do rodapé indisponível.',
  'Pesquisar prompts', 'Explorar', 'Resultados', 'Casos de uso', 'Estilos', 'Técnicas', 'Destaques', 'Tendências', 'Tarefas', 'Câmara e movimento',
  'Modelos', 'Coleções', 'Criadores', 'Temas', 'Grupo de temas', 'Estado residual', 'Relacionado', 'Melhores prompts', 'Todos os prompts',
  'Filtros', 'Variáveis', 'Evidências', 'Perguntas frequentes', 'Página anterior', 'Página seguinte', 'Identidade', 'Resultado', 'Prompt', 'Entradas',
  'Parâmetros', 'Exemplos', 'Fluxo de trabalho', 'Variações', 'Fonte + sinais', 'Ações', 'Obrigatório', 'Opcional', 'Páginas relacionadas',
)
const hi = row(
  'मुख्य सामग्री पर जाएँ', 'मुख्य नेविगेशन', 'भाषा', 'ब्रेडक्रंब', 'फुटर', 'फुटर नेविगेशन उपलब्ध नहीं है।',
  'प्रॉम्प्ट खोजें', 'खोजें', 'आउटपुट', 'उपयोग के मामले', 'शैलियाँ', 'तकनीकें', 'विशेष', 'ट्रेंडिंग', 'कार्य', 'कैमरा और गति',
  'मॉडल', 'संग्रह', 'निर्माता', 'विषय', 'विषय समूह', 'शेष स्थिति', 'संबंधित', 'शीर्ष प्रॉम्प्ट', 'सभी प्रॉम्प्ट',
  'फ़िल्टर', 'चर', 'साक्ष्य', 'अक्सर पूछे जाने वाले प्रश्न', 'पिछला पृष्ठ', 'अगला पृष्ठ', 'पहचान', 'परिणाम', 'प्रॉम्प्ट', 'इनपुट',
  'पैरामीटर', 'उदाहरण', 'कार्यप्रवाह', 'रूपांतर', 'स्रोत + संकेत', 'कार्रवाइयाँ', 'आवश्यक', 'वैकल्पिक', 'संबंधित पृष्ठ',
)
const th = row(
  'ข้ามไปยังเนื้อหา', 'การนำทางหลัก', 'ภาษา', 'เส้นทางนำทาง', 'ส่วนท้าย', 'ไม่มีการนำทางส่วนท้าย',
  'ค้นหาพรอมต์', 'สำรวจ', 'ผลลัพธ์', 'กรณีใช้งาน', 'สไตล์', 'เทคนิค', 'แนะนำ', 'กำลังนิยม', 'งาน', 'กล้องและการเคลื่อนไหว',
  'โมเดล', 'คอลเลกชัน', 'ผู้สร้าง', 'หัวข้อ', 'กลุ่มหัวข้อ', 'สถานะอื่น', 'ที่เกี่ยวข้อง', 'พรอมต์ยอดนิยม', 'พรอมต์ทั้งหมด',
  'ตัวกรอง', 'ตัวแปร', 'หลักฐาน', 'คำถามที่พบบ่อย', 'หน้าก่อนหน้า', 'หน้าถัดไป', 'ข้อมูลพื้นฐาน', 'ผลลัพธ์', 'พรอมต์', 'อินพุต',
  'พารามิเตอร์', 'ตัวอย่าง', 'เวิร์กโฟลว์', 'รูปแบบต่าง ๆ', 'แหล่งที่มา + สัญญาณ', 'การดำเนินการ', 'จำเป็น', 'ไม่บังคับ', 'หน้าที่เกี่ยวข้อง',
)
const tr = row(
  'İçeriğe geç', 'Ana gezinme', 'Dil', 'İçerik yolu', 'Alt bilgi', 'Alt bilgi gezinmesi kullanılamıyor.',
  'İstemlerde ara', 'Keşfet', 'Çıktılar', 'Kullanım alanları', 'Stiller', 'Teknikler', 'Öne çıkanlar', 'Trendler', 'Görevler', 'Kamera ve hareket',
  'Modeller', 'Koleksiyonlar', 'Üreticiler', 'Konular', 'Konu grubu', 'Kalan durum', 'İlgili', 'En iyi istemler', 'Tüm istemler',
  'Filtreler', 'Değişkenler', 'Kanıt', 'SSS', 'Önceki sayfa', 'Sonraki sayfa', 'Kimlik', 'Sonuç', 'İstem', 'Girdiler',
  'Parametreler', 'Örnekler', 'İş akışı', 'Varyasyonlar', 'Kaynak + sinyaller', 'Eylemler', 'Gerekli', 'İsteğe bağlı', 'İlgili sayfalar',
)
const vi = row(
  'Chuyển đến nội dung', 'Điều hướng chính', 'Ngôn ngữ', 'Đường dẫn trang', 'Chân trang', 'Không có điều hướng chân trang.',
  'Tìm kiếm prompt', 'Khám phá', 'Đầu ra', 'Trường hợp sử dụng', 'Phong cách', 'Kỹ thuật', 'Nổi bật', 'Xu hướng', 'Nhiệm vụ', 'Máy quay và chuyển động',
  'Mô hình', 'Bộ sưu tập', 'Nhà sáng tạo', 'Chủ đề', 'Nhóm chủ đề', 'Trạng thái còn lại', 'Liên quan', 'Prompt hàng đầu', 'Tất cả prompt',
  'Bộ lọc', 'Biến', 'Bằng chứng', 'Câu hỏi thường gặp', 'Trang trước', 'Trang sau', 'Nhận dạng', 'Kết quả', 'Prompt', 'Đầu vào',
  'Tham số', 'Ví dụ', 'Quy trình', 'Biến thể', 'Nguồn + tín hiệu', 'Thao tác', 'Bắt buộc', 'Tùy chọn', 'Trang liên quan',
)

export const FRONTEND_CHROME: Readonly<Record<ApplicationLocale, FrontendChrome>> = Object.freeze({
  en, 'zh-CN': zhCN, 'zh-TW': zhTW, 'ja-JP': ja, 'ko-KR': ko, 'de-DE': de, 'fr-FR': fr, 'it-IT': it,
  'es-ES': es, 'es-419': es, 'pt-BR': pt, 'pt-PT': pt, 'hi-IN': hi, 'th-TH': th, 'tr-TR': tr, 'vi-VN': vi,
})
