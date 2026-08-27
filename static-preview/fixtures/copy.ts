import { APPLICATION_LOCALES, type ApplicationLocale, type PreviewRouteId } from '../src/contracts'
import { PREVIEW_ROUTES } from './routes'

type RouteCopy = Readonly<{ title: string; summary: string }>

export type LocaleCopy = Readonly<{
  chrome: Readonly<{
    brand: string
    brandAria: string
    skip: string
    menuOpen: string
    menuClose: string
    languageSelector: string
    relatedRoutes: string
    publicRepository: string
  }>
  disclosure: Readonly<{
    header: string
    eyebrow: string
    footer: string
  }>
  unavailable: Readonly<Record<'case' | 'tutorial' | 'comparison' | 'faq', Readonly<{ heading: string; body: string }>>>
  routes: Readonly<Record<PreviewRouteId, RouteCopy>>
  countTemplate: string
  modules: Readonly<{
    hub: Readonly<{
      directory: string
      searchLabel: string
      searchUnavailable: string
      inventory: string
      featured: string
      imageCard: string
      videoCard: string
      modelCard: string
      method: string
      methodBody: string
    }>
    gallery: Readonly<{
      filter: string
      filterBody: string
      cards: string
      composition: string
      motion: string
      light: string
      guide: string
      guideBody: string
    }>
    entity: Readonly<{
      overview: string
      overviewBody: string
      list: string
      listBody: string
      comparison: string
    }>
    detail: Readonly<Record<'identity' | 'outcome' | 'prompt' | 'inputs' | 'variables' | 'parameters' | 'examples' | 'workflow' | 'useCases' | 'variations' | 'provenance' | 'faq', Readonly<{ heading: string; body: string }>> & Readonly<{ promptCode: string }>>
  }>
  localeNames: Readonly<Record<ApplicationLocale, string>>
}>

export type PreviewCopy = Readonly<Record<ApplicationLocale, LocaleCopy>>

type LocaleSeed = Readonly<{
  brand: string
  preview: string
  synthetic: string
  provenance: string
  directory: string
  gallery: string
  image: string
  video: string
  model: string
  prompt: string
  unavailable: string
  notice: string
  skip: string
  menuOpen: string
  menuClose: string
  languageSelector: string
  relatedRoutes: string
  repository: string
  footer: string
  search: string
  searchUnavailable: string
  inventory: string
  featured: string
  method: string
  filter: string
  cards: string
  guide: string
  overview: string
  list: string
  comparison: string
  identity: string
  outcome: string
  inputs: string
  variables: string
  parameters: string
  examples: string
  workflow: string
  useCases: string
  variations: string
  faq: string
  subject: string
  light: string
  motion: string
  summary: (title: string) => string
  count: (count: number) => string
}>

const LOCALE_NAMES: Readonly<Record<ApplicationLocale, string>> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'de-DE': 'Deutsch',
  'fr-FR': 'Français',
  'it-IT': 'Italiano',
  'es-ES': 'Español',
  'es-419': 'Español latinoamericano',
  'pt-BR': 'Português brasileiro',
  'pt-PT': 'Português europeu',
  'hi-IN': 'हिन्दी',
  'th-TH': 'ไทย',
  'tr-TR': 'Türkçe',
  'vi-VN': 'Tiếng Việt',
}

const SEEDS: Readonly<Record<ApplicationLocale, LocaleSeed>> = {
  en: { brand: 'Preview Beta', preview: 'Preview Beta', synthetic: 'Synthetic content', provenance: 'Provenance: synthetic', directory: 'Prompt directory', gallery: 'gallery', image: 'Image', video: 'Video', model: 'Model', prompt: 'Prompt study', unavailable: 'unavailable', notice: 'This Preview contains synthetic material only; no verified third-party material is shown.', skip: 'Skip to content', menuOpen: 'Open language menu', menuClose: 'Close language menu', languageSelector: 'Preview language selector', relatedRoutes: 'Related Preview routes', repository: 'Public GitHub repository', footer: 'Public, synthetic-only, and noindex. This is not a production or SEO release.', search: 'Search the synthetic directory', searchUnavailable: 'Search is unavailable in this static Preview.', inventory: 'Approved synthetic prompt routes are listed here.', featured: 'Featured collections', method: 'Method and provenance', filter: 'Filter disclosure', cards: 'Synthetic prompt cards', guide: 'Preview guide', overview: 'Entity overview', list: 'Prompt list', comparison: 'Comparison', identity: 'Identity', outcome: 'Outcome', inputs: 'Inputs', variables: 'Variables', parameters: 'Parameters', examples: 'Examples', workflow: 'Workflow', useCases: 'Use cases', variations: 'Variations', faq: 'FAQ', subject: 'subject', light: 'light', motion: 'motion', summary: (title) => `${title} is a synthetic, non-production Preview route.`, count: (count) => `${count} approved synthetic prompt routes.` },
  'zh-CN': { brand: '预览版', preview: '预览版', synthetic: '合成内容', provenance: '来源：合成', directory: '提示词目录', gallery: '画廊', image: '图像', video: '视频', model: '模型', prompt: '提示词研究', unavailable: '暂不可用', notice: '此预览仅包含合成材料；不展示任何经过验证的第三方材料。', skip: '跳到主要内容', menuOpen: '打开语言菜单', menuClose: '关闭语言菜单', languageSelector: '预览语言选择器', relatedRoutes: '相关预览路线', repository: '公开 GitHub 仓库', footer: '公开、仅合成且不索引；这不是生产或 SEO 发布。', search: '搜索合成目录', searchUnavailable: '此静态预览不提供搜索。', inventory: '此处列出已批准的合成提示词路线。', featured: '精选集合', method: '方法与来源', filter: '筛选说明', cards: '合成提示词卡片', guide: '预览指南', overview: '实体概览', list: '提示词列表', comparison: '对比', identity: '身份', outcome: '结果', inputs: '输入', variables: '变量', parameters: '参数', examples: '示例', workflow: '工作流', useCases: '使用场景', variations: '变体', faq: '常见问题', subject: '主体', light: '光线', motion: '运动', summary: (title) => `${title} 是仅供预览的合成、非生产路线。`, count: (count) => `${count} 条已批准的合成提示词路线。` },
  'zh-TW': { brand: '預覽版', preview: '預覽版', synthetic: '合成內容', provenance: '來源：合成', directory: '提示詞目錄', gallery: '圖庫', image: '影像', video: '影片', model: '模型', prompt: '提示詞研究', unavailable: '暫時無法提供', notice: '此預覽只包含合成材料；不展示已驗證的第三方材料。', skip: '跳至主要內容', menuOpen: '開啟語言選單', menuClose: '關閉語言選單', languageSelector: '預覽語言選擇器', relatedRoutes: '相關預覽路線', repository: '公開 GitHub 儲存庫', footer: '公開、僅合成且不索引；這不是正式或 SEO 發布。', search: '搜尋合成目錄', searchUnavailable: '此靜態預覽不提供搜尋。', inventory: '此處列出已核准的合成提示詞路線。', featured: '精選集合', method: '方法與來源', filter: '篩選說明', cards: '合成提示詞卡片', guide: '預覽指南', overview: '實體概覽', list: '提示詞清單', comparison: '比較', identity: '身分', outcome: '結果', inputs: '輸入', variables: '變數', parameters: '參數', examples: '範例', workflow: '工作流程', useCases: '使用情境', variations: '變化', faq: '常見問題', subject: '主體', light: '光線', motion: '動態', summary: (title) => `${title} 是僅供預覽的合成、非正式路線。`, count: (count) => `${count} 條已核准的合成提示詞路線。` },
  'ja-JP': { brand: 'プレビュー版', preview: 'プレビュー版', synthetic: '合成コンテンツ', provenance: '来歴：合成', directory: 'プロンプト一覧', gallery: 'ギャラリー', image: '画像', video: '動画', model: 'モデル', prompt: 'プロンプト研究', unavailable: '利用できません', notice: 'このプレビューには合成素材のみを含み、検証済みの第三者素材は表示しません。', skip: '本文へ移動', menuOpen: '言語メニューを開く', menuClose: '言語メニューを閉じる', languageSelector: 'プレビュー言語選択', relatedRoutes: '関連プレビュー', repository: '公開 GitHub リポジトリ', footer: '公開・合成のみ・noindexです。本番または SEO リリースではありません。', search: '合成ディレクトリを検索', searchUnavailable: 'この静的プレビューでは検索できません。', inventory: '承認済みの合成プロンプトをここに表示します。', featured: '注目コレクション', method: '方法と来歴', filter: 'フィルターの説明', cards: '合成プロンプトカード', guide: 'プレビューガイド', overview: 'エンティティ概要', list: 'プロンプト一覧', comparison: '比較', identity: '識別情報', outcome: '結果', inputs: '入力', variables: '変数', parameters: 'パラメーター', examples: '例', workflow: 'ワークフロー', useCases: '用途', variations: 'バリエーション', faq: 'よくある質問', subject: '主題', light: '光', motion: '動き', summary: (title) => `${title} は合成コンテンツのみの非本番プレビューです。`, count: (count) => `承認済み合成プロンプトは ${count} 件です。` },
  'ko-KR': { brand: '미리보기 베타', preview: '미리보기 베타', synthetic: '합성 콘텐츠', provenance: '출처: 합성', directory: '프롬프트 디렉터리', gallery: '갤러리', image: '이미지', video: '비디오', model: '모델', prompt: '프롬프트 연구', unavailable: '사용할 수 없음', notice: '이 미리보기에는 합성 자료만 있으며 검증된 제3자 자료는 표시하지 않습니다.', skip: '본문으로 건너뛰기', menuOpen: '언어 메뉴 열기', menuClose: '언어 메뉴 닫기', languageSelector: '미리보기 언어 선택', relatedRoutes: '관련 미리보기 경로', repository: '공개 GitHub 저장소', footer: '공개, 합성 전용, noindex입니다. 프로덕션 또는 SEO 릴리스가 아닙니다.', search: '합성 디렉터리 검색', searchUnavailable: '이 정적 미리보기에서는 검색할 수 없습니다.', inventory: '승인된 합성 프롬프트 경로가 여기에 나열됩니다.', featured: '추천 컬렉션', method: '방법과 출처', filter: '필터 안내', cards: '합성 프롬프트 카드', guide: '미리보기 안내', overview: '엔터티 개요', list: '프롬프트 목록', comparison: '비교', identity: '식별', outcome: '결과', inputs: '입력', variables: '변수', parameters: '매개변수', examples: '예시', workflow: '워크플로', useCases: '사용 사례', variations: '변형', faq: '자주 묻는 질문', subject: '주제', light: '빛', motion: '움직임', summary: (title) => `${title}은 합성 콘텐츠만 사용하는 비프로덕션 미리보기 경로입니다.`, count: (count) => `승인된 합성 프롬프트 경로 ${count}개.` },
  'de-DE': { brand: 'Vorschau Beta', preview: 'Vorschau Beta', synthetic: 'Synthetische Inhalte', provenance: 'Herkunft: synthetisch', directory: 'Prompt-Verzeichnis', gallery: 'Galerie', image: 'Bild', video: 'Video', model: 'Modell', prompt: 'Prompt-Studie', unavailable: 'nicht verfügbar', notice: 'Diese Vorschau enthält nur synthetisches Material und zeigt kein verifiziertes Material Dritter.', skip: 'Zum Inhalt springen', menuOpen: 'Sprachmenü öffnen', menuClose: 'Sprachmenü schließen', languageSelector: 'Sprachauswahl der Vorschau', relatedRoutes: 'Verwandte Vorschau-Routen', repository: 'Öffentliches GitHub-Repository', footer: 'Öffentlich, nur synthetisch und noindex. Dies ist keine Produktions- oder SEO-Veröffentlichung.', search: 'Synthetisches Verzeichnis durchsuchen', searchUnavailable: 'Die Suche ist in dieser statischen Vorschau nicht verfügbar.', inventory: 'Hier stehen freigegebene synthetische Prompt-Routen.', featured: 'Ausgewählte Sammlungen', method: 'Methode und Herkunft', filter: 'Filterhinweis', cards: 'Synthetische Prompt-Karten', guide: 'Vorschau-Leitfaden', overview: 'Entitätsübersicht', list: 'Prompt-Liste', comparison: 'Vergleich', identity: 'Identität', outcome: 'Ergebnis', inputs: 'Eingaben', variables: 'Variablen', parameters: 'Parameter', examples: 'Beispiele', workflow: 'Arbeitsablauf', useCases: 'Anwendungsfälle', variations: 'Varianten', faq: 'FAQ', subject: 'Motiv', light: 'Licht', motion: 'Bewegung', summary: (title) => `${title} ist eine synthetische Vorschau-Route und nicht für die Produktion bestimmt.`, count: (count) => `${count} freigegebene synthetische Prompt-Routen.` },
  'fr-FR': { brand: 'Bêta de prévisualisation', preview: 'Bêta de prévisualisation', synthetic: 'Contenu synthétique', provenance: 'Provenance : synthétique', directory: 'Répertoire de prompts', gallery: 'galerie', image: 'Image', video: 'Vidéo', model: 'Modèle', prompt: 'Étude de prompt', unavailable: 'indisponible', notice: 'Cette prévisualisation ne contient que du matériel synthétique et n’affiche aucun matériel tiers vérifié.', skip: 'Aller au contenu', menuOpen: 'Ouvrir le menu des langues', menuClose: 'Fermer le menu des langues', languageSelector: 'Sélecteur de langue', relatedRoutes: 'Routes de prévisualisation associées', repository: 'Dépôt GitHub public', footer: 'Public, synthétique uniquement et noindex. Ce n’est pas une publication de production ou SEO.', search: 'Rechercher dans le répertoire synthétique', searchUnavailable: 'La recherche est indisponible dans cette prévisualisation statique.', inventory: 'Les routes de prompts synthétiques approuvées sont listées ici.', featured: 'Collections en vedette', method: 'Méthode et provenance', filter: 'Information sur le filtre', cards: 'Cartes de prompts synthétiques', guide: 'Guide de prévisualisation', overview: 'Aperçu de l’entité', list: 'Liste de prompts', comparison: 'Comparaison', identity: 'Identité', outcome: 'Résultat', inputs: 'Entrées', variables: 'Variables', parameters: 'Paramètres', examples: 'Exemples', workflow: 'Flux de travail', useCases: 'Cas d’utilisation', variations: 'Variantes', faq: 'FAQ', subject: 'sujet', light: 'lumière', motion: 'mouvement', summary: (title) => `${title} est une route de prévisualisation synthétique et non destinée à la production.`, count: (count) => `${count} routes de prompts synthétiques approuvées.` },
  'it-IT': { brand: 'Anteprima Beta', preview: 'Anteprima Beta', synthetic: 'Contenuto sintetico', provenance: 'Provenienza: sintetica', directory: 'Directory dei prompt', gallery: 'galleria', image: 'Immagine', video: 'Video', model: 'Modello', prompt: 'Studio del prompt', unavailable: 'non disponibile', notice: 'Questa anteprima contiene solo materiale sintetico e non mostra materiale di terze parti verificato.', skip: 'Vai al contenuto', menuOpen: 'Apri il menu lingue', menuClose: 'Chiudi il menu lingue', languageSelector: 'Selettore lingua dell’anteprima', relatedRoutes: 'Percorsi di anteprima correlati', repository: 'Repository GitHub pubblico', footer: 'Pubblico, solo sintetico e noindex. Non è una pubblicazione di produzione o SEO.', search: 'Cerca nella directory sintetica', searchUnavailable: 'La ricerca non è disponibile in questa anteprima statica.', inventory: 'Qui sono elencati i percorsi di prompt sintetici approvati.', featured: 'Raccolte in evidenza', method: 'Metodo e provenienza', filter: 'Informazioni sul filtro', cards: 'Schede di prompt sintetici', guide: 'Guida dell’anteprima', overview: 'Panoramica dell’entità', list: 'Elenco prompt', comparison: 'Confronto', identity: 'Identità', outcome: 'Risultato', inputs: 'Input', variables: 'Variabili', parameters: 'Parametri', examples: 'Esempi', workflow: 'Flusso di lavoro', useCases: 'Casi d’uso', variations: 'Varianti', faq: 'FAQ', subject: 'soggetto', light: 'luce', motion: 'movimento', summary: (title) => `${title} è un percorso di anteprima sintetico e non di produzione.`, count: (count) => `${count} percorsi di prompt sintetici approvati.` },
  'es-ES': { brand: 'Vista previa Beta', preview: 'Vista previa Beta', synthetic: 'Contenido sintético', provenance: 'Procedencia: sintética', directory: 'Directorio de prompts', gallery: 'galería', image: 'Imagen', video: 'Vídeo', model: 'Modelo', prompt: 'Estudio de prompt', unavailable: 'no disponible', notice: 'Esta vista previa solo contiene material sintético y no muestra material verificado de terceros.', skip: 'Saltar al contenido', menuOpen: 'Abrir menú de idioma', menuClose: 'Cerrar menú de idioma', languageSelector: 'Selector de idioma', relatedRoutes: 'Rutas de vista previa relacionadas', repository: 'Repositorio público de GitHub', footer: 'Público, solo sintético y noindex. No es una publicación de producción ni de SEO.', search: 'Buscar en el directorio sintético', searchUnavailable: 'La búsqueda no está disponible en esta vista previa estática.', inventory: 'Aquí se muestran las rutas de prompts sintéticos aprobadas.', featured: 'Colecciones destacadas', method: 'Método y procedencia', filter: 'Aviso de filtro', cards: 'Tarjetas de prompts sintéticos', guide: 'Guía de vista previa', overview: 'Resumen de entidad', list: 'Lista de prompts', comparison: 'Comparación', identity: 'Identidad', outcome: 'Resultado', inputs: 'Entradas', variables: 'Variables', parameters: 'Parámetros', examples: 'Ejemplos', workflow: 'Flujo de trabajo', useCases: 'Casos de uso', variations: 'Variaciones', faq: 'Preguntas frecuentes', subject: 'sujeto', light: 'luz', motion: 'movimiento', summary: (title) => `${title} es una ruta sintética de vista previa y no de producción.`, count: (count) => `${count} rutas de prompts sintéticos aprobadas.` },
  'es-419': { brand: 'Vista previa latinoamericana Beta', preview: 'Vista previa Beta', synthetic: 'Contenido sintético', provenance: 'Procedencia: sintética', directory: 'Directorio de prompts', gallery: 'galería', image: 'Imagen', video: 'Video', model: 'Modelo', prompt: 'Estudio de prompt', unavailable: 'no disponible', notice: 'Esta vista previa solo contiene material sintético y no muestra material verificado de terceros.', skip: 'Saltar al contenido', menuOpen: 'Abrir menú de idioma', menuClose: 'Cerrar menú de idioma', languageSelector: 'Selector de idioma', relatedRoutes: 'Rutas relacionadas de vista previa', repository: 'Repositorio público de GitHub', footer: 'Público, solo sintético y noindex. No es una publicación de producción ni SEO.', search: 'Buscar en el directorio sintético', searchUnavailable: 'La búsqueda no está disponible en esta vista previa estática.', inventory: 'Aquí aparecen las rutas de prompts sintéticos aprobadas.', featured: 'Colecciones destacadas', method: 'Método y procedencia', filter: 'Aviso de filtro', cards: 'Tarjetas de prompts sintéticos', guide: 'Guía de vista previa', overview: 'Resumen de entidad', list: 'Lista de prompts', comparison: 'Comparación', identity: 'Identidad', outcome: 'Resultado', inputs: 'Entradas', variables: 'Variables', parameters: 'Parámetros', examples: 'Ejemplos', workflow: 'Flujo de trabajo', useCases: 'Casos de uso', variations: 'Variaciones', faq: 'Preguntas frecuentes', subject: 'sujeto', light: 'luz', motion: 'movimiento', summary: (title) => `${title} es una ruta sintética de vista previa, no de producción.`, count: (count) => `${count} rutas aprobadas de prompts sintéticos.` },
  'pt-BR': { brand: 'Prévia Beta', preview: 'Prévia Beta', synthetic: 'Conteúdo sintético', provenance: 'Procedência: sintética', directory: 'Diretório de prompts', gallery: 'galeria', image: 'Imagem', video: 'Vídeo', model: 'Modelo', prompt: 'Estudo de prompt', unavailable: 'indisponível', notice: 'Esta prévia contém apenas material sintético e não mostra material verificado de terceiros.', skip: 'Ir para o conteúdo', menuOpen: 'Abrir menu de idiomas', menuClose: 'Fechar menu de idiomas', languageSelector: 'Seletor de idioma da prévia', relatedRoutes: 'Rotas relacionadas da prévia', repository: 'Repositório público no GitHub', footer: 'Público, somente sintético e noindex. Isto não é uma publicação de produção ou SEO.', search: 'Pesquisar no diretório sintético', searchUnavailable: 'A pesquisa não está disponível nesta prévia estática.', inventory: 'As rotas de prompts sintéticos aprovadas estão listadas aqui.', featured: 'Coleções em destaque', method: 'Método e procedência', filter: 'Aviso de filtro', cards: 'Cartões de prompts sintéticos', guide: 'Guia da prévia', overview: 'Visão geral da entidade', list: 'Lista de prompts', comparison: 'Comparação', identity: 'Identidade', outcome: 'Resultado', inputs: 'Entradas', variables: 'Variáveis', parameters: 'Parâmetros', examples: 'Exemplos', workflow: 'Fluxo de trabalho', useCases: 'Casos de uso', variations: 'Variações', faq: 'Perguntas frequentes', subject: 'assunto', light: 'luz', motion: 'movimento', summary: (title) => `${title} é uma rota sintética de prévia e não de produção.`, count: (count) => `${count} rotas de prompts sintéticos aprovadas.` },
  'pt-PT': { brand: 'Pré-visualização Beta', preview: 'Pré-visualização Beta', synthetic: 'Conteúdo sintético', provenance: 'Proveniência: sintética', directory: 'Diretório de prompts', gallery: 'galeria', image: 'Imagem', video: 'Vídeo', model: 'Modelo', prompt: 'Estudo de prompt', unavailable: 'indisponível', notice: 'Esta pré-visualização contém apenas material sintético e não apresenta material de terceiros verificado.', skip: 'Saltar para o conteúdo', menuOpen: 'Abrir menu de idiomas', menuClose: 'Fechar menu de idiomas', languageSelector: 'Seletor de idioma da pré-visualização', relatedRoutes: 'Rotas de pré-visualização relacionadas', repository: 'Repositório público do GitHub', footer: 'Público, apenas sintético e noindex. Não é uma publicação de produção ou SEO.', search: 'Pesquisar no diretório sintético', searchUnavailable: 'A pesquisa não está disponível nesta pré-visualização estática.', inventory: 'As rotas de prompts sintéticos aprovadas estão aqui listadas.', featured: 'Coleções em destaque', method: 'Método e proveniência', filter: 'Aviso de filtro', cards: 'Cartões de prompts sintéticos', guide: 'Guia de pré-visualização', overview: 'Visão geral da entidade', list: 'Lista de prompts', comparison: 'Comparação', identity: 'Identidade', outcome: 'Resultado', inputs: 'Entradas', variables: 'Variáveis', parameters: 'Parâmetros', examples: 'Exemplos', workflow: 'Fluxo de trabalho', useCases: 'Casos de utilização', variations: 'Variações', faq: 'Perguntas frequentes', subject: 'assunto', light: 'luz', motion: 'movimento', summary: (title) => `${title} é uma rota sintética de pré-visualização e não de produção.`, count: (count) => `${count} rotas de prompts sintéticos aprovadas.` },
  'hi-IN': { brand: 'पूर्वावलोकन बीटा', preview: 'पूर्वावलोकन बीटा', synthetic: 'कृत्रिम सामग्री', provenance: 'उत्पत्ति: कृत्रिम', directory: 'प्रॉम्प्ट निर्देशिका', gallery: 'गैलरी', image: 'छवि', video: 'वीडियो', model: 'मॉडल', prompt: 'प्रॉम्प्ट अध्ययन', unavailable: 'उपलब्ध नहीं', notice: 'इस पूर्वावलोकन में केवल कृत्रिम सामग्री है और सत्यापित तृतीय-पक्ष सामग्री नहीं दिखाई जाती।', skip: 'मुख्य सामग्री पर जाएँ', menuOpen: 'भाषा मेनू खोलें', menuClose: 'भाषा मेनू बंद करें', languageSelector: 'पूर्वावलोकन भाषा चयन', relatedRoutes: 'संबंधित पूर्वावलोकन मार्ग', repository: 'सार्वजनिक GitHub भंडार', footer: 'सार्वजनिक, केवल कृत्रिम और noindex। यह उत्पादन या SEO रिलीज़ नहीं है।', search: 'कृत्रिम निर्देशिका खोजें', searchUnavailable: 'इस स्थिर पूर्वावलोकन में खोज उपलब्ध नहीं है।', inventory: 'स्वीकृत कृत्रिम प्रॉम्प्ट मार्ग यहाँ सूचीबद्ध हैं।', featured: 'चुनिंदा संग्रह', method: 'विधि और उत्पत्ति', filter: 'फ़िल्टर विवरण', cards: 'कृत्रिम प्रॉम्प्ट कार्ड', guide: 'पूर्वावलोकन मार्गदर्शिका', overview: 'इकाई अवलोकन', list: 'प्रॉम्प्ट सूची', comparison: 'तुलना', identity: 'पहचान', outcome: 'परिणाम', inputs: 'इनपुट', variables: 'चर', parameters: 'पैरामीटर', examples: 'उदाहरण', workflow: 'कार्यप्रवाह', useCases: 'उपयोग के मामले', variations: 'रूपांतर', faq: 'सामान्य प्रश्न', subject: 'विषय', light: 'प्रकाश', motion: 'गति', summary: (title) => `${title} केवल कृत्रिम सामग्री वाला गैर-उत्पादन पूर्वावलोकन मार्ग है।`, count: (count) => `${count} स्वीकृत कृत्रिम प्रॉम्प्ट मार्ग।` },
  'th-TH': { brand: 'พรีวิวเบต้า', preview: 'พรีวิวเบต้า', synthetic: 'เนื้อหาสังเคราะห์', provenance: 'ที่มา: สังเคราะห์', directory: 'ไดเรกทอรีพรอมป์ต์', gallery: 'แกลเลอรี', image: 'ภาพ', video: 'วิดีโอ', model: 'โมเดล', prompt: 'การศึกษาพรอมป์ต์', unavailable: 'ไม่พร้อมใช้งาน', notice: 'พรีวิวนี้มีเฉพาะเนื้อหาสังเคราะห์และไม่แสดงเนื้อหาของบุคคลที่สามที่ผ่านการยืนยัน', skip: 'ข้ามไปยังเนื้อหา', menuOpen: 'เปิดเมนูภาษา', menuClose: 'ปิดเมนูภาษา', languageSelector: 'ตัวเลือกภาษาพรีวิว', relatedRoutes: 'เส้นทางพรีวิวที่เกี่ยวข้อง', repository: 'คลัง GitHub สาธารณะ', footer: 'สาธารณะ เฉพาะเนื้อหาสังเคราะห์ และ noindex ไม่ใช่การเผยแพร่จริงหรือ SEO', search: 'ค้นหาไดเรกทอรีสังเคราะห์', searchUnavailable: 'การค้นหาไม่พร้อมใช้งานในพรีวิวแบบสแตติกนี้', inventory: 'มีรายการเส้นทางพรอมป์ต์สังเคราะห์ที่อนุมัติไว้ที่นี่', featured: 'คอลเลกชันเด่น', method: 'วิธีการและที่มา', filter: 'คำอธิบายตัวกรอง', cards: 'การ์ดพรอมป์ต์สังเคราะห์', guide: 'คู่มือพรีวิว', overview: 'ภาพรวมเอนทิตี', list: 'รายการพรอมป์ต์', comparison: 'การเปรียบเทียบ', identity: 'ข้อมูลระบุตัวตน', outcome: 'ผลลัพธ์', inputs: 'ข้อมูลนำเข้า', variables: 'ตัวแปร', parameters: 'พารามิเตอร์', examples: 'ตัวอย่าง', workflow: 'เวิร์กโฟลว์', useCases: 'กรณีใช้งาน', variations: 'รูปแบบต่าง ๆ', faq: 'คำถามที่พบบ่อย', subject: 'หัวข้อ', light: 'แสง', motion: 'การเคลื่อนไหว', summary: (title) => `${title} เป็นเส้นทางพรีวิวเนื้อหาสังเคราะห์ที่ไม่ใช่การผลิต`, count: (count) => `เส้นทางพรอมป์ต์สังเคราะห์ที่อนุมัติ ${count} รายการ` },
  'tr-TR': { brand: 'Önizleme Beta', preview: 'Önizleme Beta', synthetic: 'Sentetik içerik', provenance: 'Köken: sentetik', directory: 'İstem dizini', gallery: 'galeri', image: 'Görsel', video: 'Video', model: 'Model', prompt: 'İstem çalışması', unavailable: 'kullanılamıyor', notice: 'Bu önizleme yalnızca sentetik malzeme içerir ve doğrulanmış üçüncü taraf malzemesi göstermez.', skip: 'İçeriğe geç', menuOpen: 'Dil menüsünü aç', menuClose: 'Dil menüsünü kapat', languageSelector: 'Önizleme dil seçici', relatedRoutes: 'İlgili önizleme rotaları', repository: 'Herkese açık GitHub deposu', footer: 'Herkese açık, yalnızca sentetik ve noindex. Bu bir üretim veya SEO yayını değildir.', search: 'Sentetik dizinde ara', searchUnavailable: 'Bu statik önizlemede arama kullanılamaz.', inventory: 'Onaylanan sentetik istem rotaları burada listelenir.', featured: 'Öne çıkan koleksiyonlar', method: 'Yöntem ve köken', filter: 'Filtre açıklaması', cards: 'Sentetik istem kartları', guide: 'Önizleme rehberi', overview: 'Varlık özeti', list: 'İstem listesi', comparison: 'Karşılaştırma', identity: 'Kimlik', outcome: 'Sonuç', inputs: 'Girdiler', variables: 'Değişkenler', parameters: 'Parametreler', examples: 'Örnekler', workflow: 'İş akışı', useCases: 'Kullanım alanları', variations: 'Varyasyonlar', faq: 'Sık sorulan sorular', subject: 'konu', light: 'ışık', motion: 'hareket', summary: (title) => `${title}, üretim amaçlı olmayan sentetik bir önizleme rotasıdır.`, count: (count) => `${count} onaylı sentetik istem rotası.` },
  'vi-VN': { brand: 'Bản xem trước Beta', preview: 'Bản xem trước Beta', synthetic: 'Nội dung tổng hợp', provenance: 'Nguồn gốc: tổng hợp', directory: 'Thư mục prompt', gallery: 'thư viện', image: 'Hình ảnh', video: 'Video', model: 'Mô hình', prompt: 'Nghiên cứu prompt', unavailable: 'không khả dụng', notice: 'Bản xem trước này chỉ có tài liệu tổng hợp và không hiển thị tài liệu bên thứ ba đã xác minh.', skip: 'Chuyển đến nội dung', menuOpen: 'Mở menu ngôn ngữ', menuClose: 'Đóng menu ngôn ngữ', languageSelector: 'Bộ chọn ngôn ngữ xem trước', relatedRoutes: 'Lộ trình xem trước liên quan', repository: 'Kho GitHub công khai', footer: 'Công khai, chỉ tổng hợp và noindex. Đây không phải bản phát hành sản xuất hoặc SEO.', search: 'Tìm trong thư mục tổng hợp', searchUnavailable: 'Không có tìm kiếm trong bản xem trước tĩnh này.', inventory: 'Các lộ trình prompt tổng hợp đã được phê duyệt được liệt kê tại đây.', featured: 'Bộ sưu tập nổi bật', method: 'Phương pháp và nguồn gốc', filter: 'Giải thích bộ lọc', cards: 'Thẻ prompt tổng hợp', guide: 'Hướng dẫn xem trước', overview: 'Tổng quan thực thể', list: 'Danh sách prompt', comparison: 'So sánh', identity: 'Danh tính', outcome: 'Kết quả', inputs: 'Đầu vào', variables: 'Biến', parameters: 'Tham số', examples: 'Ví dụ', workflow: 'Quy trình', useCases: 'Trường hợp sử dụng', variations: 'Biến thể', faq: 'Câu hỏi thường gặp', subject: 'chủ thể', light: 'ánh sáng', motion: 'chuyển động', summary: (title) => `${title} là lộ trình Bản xem trước tổng hợp, không dùng cho sản xuất.`, count: (count) => `${count} lộ trình prompt tổng hợp đã được phê duyệt.` },
}

function routeTitle(seed: LocaleSeed, routeId: PreviewRouteId): string {
  const routeLabel =
    routeId === 'hub-prompts'
      ? seed.directory
      : routeId === 'gallery-image'
        ? `${seed.image} ${seed.gallery}`
        : routeId === 'gallery-video'
          ? `${seed.video} ${seed.gallery}`
          : routeId.startsWith('entity-model-')
            ? `${seed.model} ${routeId.slice(-2)}`
            : `${seed.prompt} ${routeId.slice(-3)}`
  return `${seed.brand}: ${routeLabel}`
}

function detailCopy(seed: LocaleSeed, heading: string): Readonly<{ heading: string; body: string }> {
  return { heading, body: seed.notice }
}

function makeLocaleCopy(seed: LocaleSeed): LocaleCopy {
  const routes = Object.fromEntries(
    PREVIEW_ROUTES.map((route) => {
      const title = routeTitle(seed, route.routeId)
      return [route.routeId, { title, summary: seed.summary(title) }]
    }),
  ) as Record<PreviewRouteId, RouteCopy>
  const unavailable = (label: string) => ({ heading: `${label} ${seed.unavailable}`, body: seed.notice })

  return {
    chrome: { brand: seed.brand, brandAria: seed.directory, skip: seed.skip, menuOpen: seed.menuOpen, menuClose: seed.menuClose, languageSelector: seed.languageSelector, relatedRoutes: seed.relatedRoutes, publicRepository: seed.repository },
    disclosure: { header: `${seed.preview} · ${seed.synthetic} · ${seed.provenance}`, eyebrow: `${seed.preview} · ${seed.synthetic}`, footer: seed.footer },
    unavailable: { case: unavailable(seed.useCases), tutorial: unavailable(seed.workflow), comparison: unavailable(seed.comparison), faq: unavailable(seed.faq) },
    routes,
    countTemplate: seed.count(0).replace('0', '{count}'),
    localeNames: LOCALE_NAMES,
    modules: {
      hub: { directory: seed.directory, searchLabel: seed.search, searchUnavailable: seed.searchUnavailable, inventory: seed.inventory, featured: seed.featured, imageCard: `${seed.image} ${seed.prompt}`, videoCard: `${seed.video} ${seed.prompt}`, modelCard: `${seed.model} ${seed.gallery}`, method: seed.method, methodBody: seed.notice },
      gallery: { filter: seed.filter, filterBody: seed.notice, cards: seed.cards, composition: seed.examples, motion: seed.motion, light: seed.light, guide: seed.guide, guideBody: seed.notice },
      entity: { overview: seed.overview, overviewBody: seed.notice, list: seed.list, listBody: seed.notice, comparison: seed.comparison },
      detail: { identity: detailCopy(seed, seed.identity), outcome: detailCopy(seed, seed.outcome), prompt: detailCopy(seed, seed.prompt), inputs: detailCopy(seed, seed.inputs), variables: detailCopy(seed, seed.variables), parameters: detailCopy(seed, seed.parameters), examples: detailCopy(seed, seed.examples), workflow: detailCopy(seed, seed.workflow), useCases: detailCopy(seed, seed.useCases), variations: detailCopy(seed, seed.variations), provenance: detailCopy(seed, seed.provenance), faq: detailCopy(seed, seed.faq), promptCode: `[${seed.subject}] · [${seed.light}] · [${seed.motion}]` },
    },
  }
}

export const PREVIEW_COPY: PreviewCopy = Object.fromEntries(
  APPLICATION_LOCALES.map((locale) => [locale, makeLocaleCopy(SEEDS[locale])]),
) as PreviewCopy
