/**
 * The Phase 3 browser harness installs an explicitly opt-in reader. Production
 * continues with no reader, so route resolution fails closed until its active
 * publication read plane exists.
 */
export async function register(): Promise<void> {
  if (process.env.NODE_ENV === 'production' || process.env.PSEO_FRONTEND_PREVIEW !== '1') return

  const { installPhase3FrontendPreview } = await import('../tests/phase3/frontend/preview-adapter')
  installPhase3FrontendPreview()
}
