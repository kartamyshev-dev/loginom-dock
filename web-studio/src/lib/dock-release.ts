// Updated only after the matching client artifacts have passed acceptance and
// have been published. Candidate builds must not appear as released downloads.
export const dockRelease: {
  version: string | null
  url: string | null
} = { version: null, url: null }
