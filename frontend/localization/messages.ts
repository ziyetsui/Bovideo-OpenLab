import type { ApplicationLocale } from '@/contracts/locale'
import { applicationLocaleSchema } from '@/contracts/locale'
import { FRONTEND_CHROME, type FrontendChrome } from './chrome'

export type FrontendMessages = Readonly<{
  prompts: string
  hubTitle: string
  hubDescription: string
  imageGalleryTitle: string
  imageGalleryDescription: string
  videoGalleryTitle: string
  videoGalleryDescription: string
  promptsSuffix: string
  sourceFallback: string
  chrome: FrontendChrome
}>

type FrontendMessageCopy = Omit<FrontendMessages, 'chrome'>

export const FRONTEND_MESSAGES: Readonly<Record<ApplicationLocale, FrontendMessageCopy>> = Object.freeze({
  en: { prompts: 'Prompts', hubTitle: 'Higgsfield Prompt Hub', hubDescription: 'Browse source-backed prompts by medium, model and task.', imageGalleryTitle: 'Image Prompt Gallery', imageGalleryDescription: 'Browse source-backed image prompts and their model pages.', videoGalleryTitle: 'Video Prompt Gallery', videoGalleryDescription: 'Browse source-backed video prompts and their model pages.', promptsSuffix: 'Prompts', sourceFallback: 'Interface translated; original prompt content remains in its source language.' },
  'zh-CN': { prompts: '提示词', hubTitle: 'Higgsfield 提示词中心', hubDescription: '按媒介、模型和任务浏览有来源证据的提示词。', imageGalleryTitle: '图片提示词库', imageGalleryDescription: '浏览有来源证据的图片提示词及其模型页面。', videoGalleryTitle: '视频提示词库', videoGalleryDescription: '浏览有来源证据的视频提示词及其模型页面。', promptsSuffix: '提示词', sourceFallback: '界面已翻译；原始提示词仍保留来源语言。' },
  'zh-TW': { prompts: '提示詞', hubTitle: 'Higgsfield 提示詞中心', hubDescription: '依媒介、模型與任務瀏覽有來源證據的提示詞。', imageGalleryTitle: '圖片提示詞庫', imageGalleryDescription: '瀏覽有來源證據的圖片提示詞及其模型頁面。', videoGalleryTitle: '影片提示詞庫', videoGalleryDescription: '瀏覽有來源證據的影片提示詞及其模型頁面。', promptsSuffix: '提示詞', sourceFallback: '介面已翻譯；原始提示詞仍保留來源語言。' },
  'ja-JP': { prompts: 'プロンプト', hubTitle: 'Higgsfield プロンプトハブ', hubDescription: 'メディア、モデル、タスク別に出典付きプロンプトを閲覧できます。', imageGalleryTitle: '画像プロンプトギャラリー', imageGalleryDescription: '出典付き画像プロンプトとモデルページを閲覧できます。', videoGalleryTitle: '動画プロンプトギャラリー', videoGalleryDescription: '出典付き動画プロンプトとモデルページを閲覧できます。', promptsSuffix: 'プロンプト', sourceFallback: '画面は翻訳済みです。元のプロンプトは原文のまま表示されます。' },
  'ko-KR': { prompts: '프롬프트', hubTitle: 'Higgsfield 프롬프트 허브', hubDescription: '미디어, 모델, 작업별로 출처가 확인된 프롬프트를 탐색하세요.', imageGalleryTitle: '이미지 프롬프트 갤러리', imageGalleryDescription: '출처가 확인된 이미지 프롬프트와 모델 페이지를 탐색하세요.', videoGalleryTitle: '비디오 프롬프트 갤러리', videoGalleryDescription: '출처가 확인된 비디오 프롬프트와 모델 페이지를 탐색하세요.', promptsSuffix: '프롬프트', sourceFallback: '인터페이스는 번역되었으며 원본 프롬프트는 출처 언어로 유지됩니다.' },
  'de-DE': { prompts: 'Prompts', hubTitle: 'Higgsfield Prompt-Zentrale', hubDescription: 'Quellengestützte Prompts nach Medium, Modell und Aufgabe durchsuchen.', imageGalleryTitle: 'Galerie für Bild-Prompts', imageGalleryDescription: 'Quellengestützte Bild-Prompts und Modellseiten durchsuchen.', videoGalleryTitle: 'Galerie für Video-Prompts', videoGalleryDescription: 'Quellengestützte Video-Prompts und Modellseiten durchsuchen.', promptsSuffix: 'Prompts', sourceFallback: 'Die Oberfläche ist übersetzt; der ursprüngliche Prompt bleibt in der Quellsprache.' },
  'fr-FR': { prompts: 'Prompts', hubTitle: 'Centre de prompts Higgsfield', hubDescription: 'Parcourez les prompts sourcés par média, modèle et tâche.', imageGalleryTitle: "Galerie de prompts d’image", imageGalleryDescription: "Parcourez les prompts d’image sourcés et leurs pages de modèle.", videoGalleryTitle: 'Galerie de prompts vidéo', videoGalleryDescription: 'Parcourez les prompts vidéo sourcés et leurs pages de modèle.', promptsSuffix: 'Prompts', sourceFallback: "L’interface est traduite ; le prompt d’origine reste dans sa langue source." },
  'it-IT': { prompts: 'Prompt', hubTitle: 'Hub dei prompt Higgsfield', hubDescription: 'Esplora prompt con fonti per mezzo, modello e attività.', imageGalleryTitle: 'Galleria di prompt per immagini', imageGalleryDescription: 'Esplora prompt per immagini con fonti e le relative pagine modello.', videoGalleryTitle: 'Galleria di prompt video', videoGalleryDescription: 'Esplora prompt video con fonti e le relative pagine modello.', promptsSuffix: 'Prompt', sourceFallback: "L’interfaccia è tradotta; il prompt originale resta nella lingua di origine." },
  'es-ES': { prompts: 'Prompts', hubTitle: 'Centro de prompts de Higgsfield', hubDescription: 'Explora prompts con fuentes por medio, modelo y tarea.', imageGalleryTitle: 'Galería de prompts de imagen', imageGalleryDescription: 'Explora prompts de imagen con fuentes y sus páginas de modelo.', videoGalleryTitle: 'Galería de prompts de vídeo', videoGalleryDescription: 'Explora prompts de vídeo con fuentes y sus páginas de modelo.', promptsSuffix: 'Prompts', sourceFallback: 'La interfaz está traducida; el prompt original se mantiene en su idioma de origen.' },
  'es-419': { prompts: 'Prompts', hubTitle: 'Centro de prompts de Higgsfield', hubDescription: 'Explora prompts con fuentes por medio, modelo y tarea.', imageGalleryTitle: 'Galería de prompts de imagen', imageGalleryDescription: 'Explora prompts de imagen con fuentes y sus páginas de modelo.', videoGalleryTitle: 'Galería de prompts de video', videoGalleryDescription: 'Explora prompts de video con fuentes y sus páginas de modelo.', promptsSuffix: 'Prompts', sourceFallback: 'La interfaz está traducida; el prompt original se mantiene en su idioma de origen.' },
  'pt-BR': { prompts: 'Prompts', hubTitle: 'Central de prompts Higgsfield', hubDescription: 'Explore prompts com fontes por mídia, modelo e tarefa.', imageGalleryTitle: 'Galeria de prompts de imagem', imageGalleryDescription: 'Explore prompts de imagem com fontes e suas páginas de modelo.', videoGalleryTitle: 'Galeria de prompts de vídeo', videoGalleryDescription: 'Explore prompts de vídeo com fontes e suas páginas de modelo.', promptsSuffix: 'Prompts', sourceFallback: 'A interface está traduzida; o prompt original permanece no idioma de origem.' },
  'pt-PT': { prompts: 'Prompts', hubTitle: 'Central de prompts Higgsfield', hubDescription: 'Explore prompts com fontes por meio, modelo e tarefa.', imageGalleryTitle: 'Galeria de prompts de imagem', imageGalleryDescription: 'Explore prompts de imagem com fontes e as respetivas páginas de modelo.', videoGalleryTitle: 'Galeria de prompts de vídeo', videoGalleryDescription: 'Explore prompts de vídeo com fontes e as respetivas páginas de modelo.', promptsSuffix: 'Prompts', sourceFallback: 'A interface está traduzida; o prompt original permanece no idioma de origem.' },
  'hi-IN': { prompts: 'प्रॉम्प्ट', hubTitle: 'Higgsfield प्रॉम्प्ट हब', hubDescription: 'माध्यम, मॉडल और कार्य के अनुसार स्रोत-समर्थित प्रॉम्प्ट देखें।', imageGalleryTitle: 'इमेज प्रॉम्प्ट गैलरी', imageGalleryDescription: 'स्रोत-समर्थित इमेज प्रॉम्प्ट और उनके मॉडल पेज देखें।', videoGalleryTitle: 'वीडियो प्रॉम्प्ट गैलरी', videoGalleryDescription: 'स्रोत-समर्थित वीडियो प्रॉम्प्ट और उनके मॉडल पेज देखें।', promptsSuffix: 'प्रॉम्प्ट', sourceFallback: 'इंटरफ़ेस अनुवादित है; मूल प्रॉम्प्ट स्रोत भाषा में रहता है।' },
  'th-TH': { prompts: 'พรอมต์', hubTitle: 'ศูนย์รวมพรอมต์ Higgsfield', hubDescription: 'เรียกดูพรอมต์ที่มีแหล่งอ้างอิงตามสื่อ โมเดล และงาน', imageGalleryTitle: 'แกลเลอรีพรอมต์รูปภาพ', imageGalleryDescription: 'เรียกดูพรอมต์รูปภาพที่มีแหล่งอ้างอิงและหน้าโมเดล', videoGalleryTitle: 'แกลเลอรีพรอมต์วิดีโอ', videoGalleryDescription: 'เรียกดูพรอมต์วิดีโอที่มีแหล่งอ้างอิงและหน้าโมเดล', promptsSuffix: 'พรอมต์', sourceFallback: 'อินเทอร์เฟซได้รับการแปลแล้ว ส่วนพรอมต์ต้นฉบับยังคงเป็นภาษาต้นทาง' },
  'tr-TR': { prompts: 'İstemler', hubTitle: 'Higgsfield İstem Merkezi', hubDescription: 'Kaynak destekli istemleri ortam, model ve göreve göre keşfedin.', imageGalleryTitle: 'Görsel İstem Galerisi', imageGalleryDescription: 'Kaynak destekli görsel istemleri ve model sayfalarını keşfedin.', videoGalleryTitle: 'Video İstem Galerisi', videoGalleryDescription: 'Kaynak destekli video istemlerini ve model sayfalarını keşfedin.', promptsSuffix: 'İstemleri', sourceFallback: 'Arayüz çevrildi; özgün istem kaynak dilinde korunur.' },
  'vi-VN': { prompts: 'Prompt', hubTitle: 'Trung tâm prompt Higgsfield', hubDescription: 'Duyệt prompt có nguồn theo phương tiện, mô hình và nhiệm vụ.', imageGalleryTitle: 'Thư viện prompt hình ảnh', imageGalleryDescription: 'Duyệt prompt hình ảnh có nguồn và các trang mô hình.', videoGalleryTitle: 'Thư viện prompt video', videoGalleryDescription: 'Duyệt prompt video có nguồn và các trang mô hình.', promptsSuffix: 'Prompt', sourceFallback: 'Giao diện đã được dịch; prompt gốc vẫn giữ ngôn ngữ nguồn.' },
})

export const messagesFor = (locale: ApplicationLocale): FrontendMessages => Object.freeze({
  ...FRONTEND_MESSAGES[locale],
  chrome: FRONTEND_CHROME[locale],
})

export const messagesForFrontendLocale = (locale: string | undefined): FrontendMessages => {
  const parsed = applicationLocaleSchema.safeParse(locale)
  return messagesFor(parsed.success ? parsed.data : 'en')
}
