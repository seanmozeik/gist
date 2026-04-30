# Completions for gist (seanmozeik/gist)

# YouTube options
complete -c gist -l youtube -d 'YouTube transcript source' -xa 'auto web no-auto yt-dlp apify'
complete -c gist -l transcriber -d 'Audio transcription backend' -xa 'auto whisper parakeet canary'
complete -c gist -l video-mode -d 'Video handling mode' -xa 'auto transcript understand'

# Slides options
complete -c gist -l slides -d 'Extract slides for video URLs'
complete -c gist -l slides-debug -d 'Show slide image paths'
complete -c gist -l slides-ocr -d 'Run OCR on extracted slides'
complete -c gist -l slides-dir -d 'Base output dir for slides' -rF
complete -c gist -l slides-scene-threshold -d 'Scene detection threshold (0.1-1.0)' -x
complete -c gist -l slides-max -d 'Maximum slides to extract' -x
complete -c gist -l slides-min-duration -d 'Minimum seconds between slides' -x
complete -c gist -l timestamps -d 'Include timestamps in transcripts'

# Content options
complete -c gist -l firecrawl -d 'Firecrawl usage' -xa 'off auto always'
complete -c gist -l format -d 'Content format' -xa 'md text'
complete -c gist -l preprocess -d 'Preprocess inputs' -xa 'off auto always'
complete -c gist -l markdown-mode -d 'Markdown conversion mode' -xa 'off auto llm readability'

# Summary options
complete -c gist -l length -d 'Summary length' -xa 'short s medium m long l xl xxl'
complete -c gist -l max-extract-characters -d 'Max characters in --extract' -x
complete -c gist -l language -l lang -d 'Output language' -xa 'auto en de english german'
complete -c gist -l max-output-tokens -d 'Hard cap for LLM output tokens' -x
complete -c gist -l force-summary -d 'Force LLM summary even for short content'
complete -c gist -l timeout -d 'Timeout for fetching/LLM (e.g. 30s, 2m)' -x
complete -c gist -l retries -d 'LLM retry attempts on timeout' -x

# Model options
complete -c gist -l model -d 'LLM model id' -x
complete -c gist -l cli -d 'Use CLI provider' -xa 'claude gemini codex agent'
complete -c gist -l prompt -d 'Override summary prompt' -x
complete -c gist -l prompt-file -d 'Read prompt from file' -rF

# Cache options
complete -c gist -l no-cache -d 'Bypass summary cache'
complete -c gist -l no-media-cache -d 'Disable media download cache'
complete -c gist -l cache-stats -d 'Print cache stats and exit'
complete -c gist -l clear-cache -d 'Delete cache database and exit'

# Output options
complete -c gist -l extract -d 'Print extracted content (no LLM)'
complete -c gist -l json -d 'Output structured JSON'
complete -c gist -l stream -d 'Stream LLM output' -xa 'auto on off'
complete -c gist -l plain -d 'Keep raw text/markdown (no ANSI)'
complete -c gist -l no-color -d 'Disable ANSI colors'
complete -c gist -l theme -d 'CLI theme' -xa 'aurora ember moss mono'

# Debug/info
complete -c gist -l verbose -d 'Print detailed progress to stderr'
complete -c gist -l debug -d 'Alias for --verbose'
complete -c gist -l metrics -d 'Metrics output' -xa 'off on detailed'
complete -c gist -s V -l version -d 'Print version and exit'
complete -c gist -s h -l help -d 'Display help'
