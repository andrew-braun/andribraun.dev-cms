# AI Project Write-up Instructions

You are tasked with analyzing a software project repository and creating a comprehensive, well-structured write-up for a portfolio website. Your analysis should be thorough, focusing on understanding the project's purpose, technical architecture, and implementation details.

## Analysis Process

1. **Repository Exploration**
   - Read the README, package.json, and any documentation files
   - Examine the project structure and key directories
   - Identify the main technologies, frameworks, and tools used
   - Look for configuration files (tsconfig.json, vite.config.ts, etc.)
   - Review key source files to understand architectural patterns
   - Check for notable implementation details (custom hooks, state management, API integrations, etc.)

2. **Context Gathering**
   - Understand the project's purpose and target audience
   - Identify the problem it solves or need it addresses
   - Note any unique or interesting technical decisions
   - Look for performance optimizations, accessibility features, or other quality indicators

## Output Format

**CRITICAL REQUIREMENT:** Your output must be RAW, UNFORMATTED MARKDOWN TEXT ONLY.

- Do NOT render or format the markdown
- Do NOT wrap the output in code blocks or code fences (no `markdown or `)
- Do NOT convert markdown to HTML
- Output the literal markdown text exactly as written, including all `<span>` tags
- The output should be plain text that can be directly copied and pasted into a `.md` file
- Start directly with the introduction text - no preamble, no explanations, just the raw markdown

Your write-up MUST be in Markdown and follow this exact structure:

### 1. Introduction (2-3 sentences)

Write in **layperson's language** that anyone can understand. Explain:

- What the project is and who it's for
- What problem it solves or what need it addresses
- A high-level overview of the technical approach (without jargon)

**Example:**
"A fast, efficient tax services website built for OTM, a financial services company working with US expats, entrepreneurs, and businesses with international operations. Built using a static-first architecture that delivers zero JavaScript by default while keeping things interactive where it matters!"

### 2. Tech Stack & Architecture

Use a bulleted list to describe:

- Primary frameworks and libraries with brief context on how they're used
- Architecture patterns (e.g., "islands architecture", "server-side rendering", "microservices")
- Key tools and their purpose
- Deployment and infrastructure

**Important:** Each technology mention must use this format:

```markdown
<span class="tech" data-tag="technology-slug">Technology Name</span>
```

**Technology Tagging Rules:**

- The `data-tag` attribute should be lowercase and hyphenated (e.g., "next-js", "react", "postgresql")
- Common frameworks: react, vue, svelte, angular, next-js, nuxt, astro, solid-js
- Backend: node-js, express, fastify, nest-js, django, flask, rails, spring-boot
- Databases: postgresql, mysql, mongodb, redis, sqlite, supabase, turso-sqlite
- Styling: tailwind, scss, sass, styled-components, css-modules, emotion
- Build tools: vite, webpack, rollup, esbuild, turbo, tsup
- Testing: vitest, jest, playwright, cypress, testing-library
- Other: typescript, graphql, rest-api, websockets, docker, kubernetes, aws, vercel, netlify

### 3. Key Implementation Details

Highlight 4-6 notable implementation aspects using **bold subheadings**. Focus on:

- Custom architectures or patterns you built
- Complex features or workflows
- Interesting technical solutions
- Development workflow improvements
- Performance optimizations
- Accessibility features

Each detail should:

- Have a descriptive **bold subheading** (e.g., "**Multi-step Form Engine**")
- Include 2-4 sub-bullets explaining the implementation
- Continue using `<span class="tech">` tags for all technology mentions

### 4. Outcome

A concise paragraph (2-3 sentences) summarizing:

- What was achieved
- The impact or benefits
- Any notable quality attributes (performance, maintainability, scalability)

## Technology Tagging Requirements

**CRITICAL:** Every single technology, framework, library, tool, or platform mentioned MUST be wrapped in a `<span>` tag.

### Correct Examples:

✅ "Built with <span class=\"tech\" data-tag=\"react\">React</span> and <span class=\"tech\" data-tag=\"typescript\">TypeScript</span>"
✅ "<span class=\"tech\" data-tag=\"next-js\">Next.js</span> 14 with the app router"
✅ "Deployed on <span class=\"tech\" data-tag=\"vercel\">Vercel</span>"
✅ "<span class=\"tech\" data-tag=\"zod\">Zod</span> v4 runtime validation"

### Incorrect Examples:

❌ "Built with React and TypeScript" (missing tags)
❌ "Next.js 14 with the app router" (missing tags)
❌ "<span class=\"tech\" data-tag=\"React\">React</span>" (data-tag should be lowercase)
❌ "<span class=\"tech\" data-tag=\"next.js\">Next.js</span>" (use hyphen, not period)

### Data-tag Conversion Rules:

- Lowercase everything: `React` → `react`
- Replace dots with hyphens: `Next.js` → `next-js`
- Replace spaces with hyphens: `AWS Lambda` → `aws-lambda`
- Keep hyphens that exist: `styled-components` → `styled-components`
- Version numbers can be outside the span: `<span class="tech" data-tag="zod">Zod</span> v4`

## Writing Style Guidelines

1. **Be Conversational but Professional**
   - Use active voice
   - Avoid corporate jargon
   - Explain "why" choices were made, not just "what" was used

2. **Show Technical Depth**
   - Highlight interesting architectural decisions
   - Mention specific patterns or techniques used
   - Include version numbers when relevant (e.g., "React 18", "Svelte 5")

3. **Keep It Concise**
   - Introduction: 2-3 sentences
   - Tech Stack: 5-12 bullets
   - Implementation Details: 4-6 sections with 2-4 sub-bullets each
   - Outcome: 2-3 sentences

4. **Focus on What Makes It Interesting**
   - Don't just list features—explain the technical solution
   - Highlight custom work over standard implementations
   - Show problem-solving and decision-making

## Example Write-up Structure

```markdown
A fast, efficient tax services website built for OTM, a financial services company working with US expats, entrepreneurs, and businesses with international operations. Built using a static-first architecture that delivers zero JavaScript by default while keeping things interactive where it matters!

## Tech Stack & Architecture

- <span class="tech" data-tag="astro">Astro</span> + <span class="tech" data-tag="svelte">Svelte</span> hybrid with islands hydration. <span class="tech" data-tag="astro">Astro</span> handles the static content while <span class="tech" data-tag="svelte">Svelte 5</span>'s modern, low-overhead components power the interactive bits.
- <span class="tech" data-tag="zag">Zag.js</span> headless UI state machines handle accessible patterns like accordions, dialogs, and multi-step forms—much more efficient than building everything from scratch!
- <span class="tech" data-tag="typescript">TypeScript</span> strict mode with <span class="tech" data-tag="zod">Zod v4</span> runtime validation
- <span class="tech" data-tag="scss">SCSS Modules</span> for component-scoped styling with centralized design tokens
- <span class="tech" data-tag="wordpress">WordPress</span> integration via <span class="tech" data-tag="graphql">GraphQL</span> and custom <span class="tech" data-tag="astro">Astro</span> content loaders
- Deployed on <span class="tech" data-tag="netlify">Netlify</span> with edge functions and <span class="tech" data-tag="turso-sqlite">Turso SQLite</span> for logging

## Key Implementation Details

**Unified PageData Architecture** — Built a single source of truth system for routing, SEO metadata, sitemap control, and redirects that works across static pages, dynamic routes, and CMS content. The data directory mirrors the pages directory exactly, so finding things is straightforward.

**Custom Content Registry** — Automatic page discovery using import.meta.glob that makes site-wide queries for sitemaps and navigation dead simple without manual registration.

**Multi-step Form Engine** — Complex consultation workflows with:

- Conditional validation using <span class="tech" data-tag="zod">Zod</span>
- Session persistence via browser storage
- <span class="tech" data-tag="zapier">Zapier</span> webhook integration for CRM sync

**Development Workflow** — Comprehensive quality tooling including:

- <span class="tech" data-tag="eslint">ESLint</span>, <span class="tech" data-tag="prettier">Prettier</span>, <span class="tech" data-tag="stylelint">Stylelint</span>
- <span class="tech" data-tag="husky">Husky</span> pre-commit hooks
- Bundle analysis via <span class="tech" data-tag="rollup-visualizer">Rollup Visualizer</span>
- Dependency architecture validation

## Outcome

A fast, accessible, and maintainable platform that handles complex international tax workflows while keeping performance solid for users worldwide. The modular architecture and strict typing make it easy to extend as the business grows.
```

## Common Pitfalls to Avoid

1. ❌ **Don't** forget to tag technologies—every single one needs a `<span>` tag
2. ❌ **Don't** use generic descriptions like "modern web app" or "full-stack application"
3. ❌ **Don't** list features without explaining the technical approach
4. ❌ **Don't** use uppercase or dots in `data-tag` attributes
5. ❌ **Don't** write overly technical introductions—remember the layperson's test
6. ❌ **Don't** mention technologies without context about how they're used

## Quality Checklist

Before submitting your write-up, verify:

- [ ] Introduction is in plain language anyone can understand
- [ ] Every technology mention has proper `<span class="tech" data-tag="...">` formatting
- [ ] All `data-tag` values are lowercase and hyphenated
- [ ] Tech Stack section explains why technologies were chosen
- [ ] 4-6 Key Implementation Details with bold subheadings
- [ ] Outcome section summarizes impact and benefits
- [ ] Writing is concise and engaging
- [ ] No jargon without explanation in the introduction
- [ ] Technical depth increases appropriately in later sections

## Final Notes

Your goal is to create a write-up that:

1. Makes the project accessible to non-technical readers in the introduction
2. Showcases technical expertise in the implementation details
3. Properly tags all technologies for filtering/search functionality
4. Tells a coherent story about what was built and why

Focus on what makes this project unique and interesting, not just what's standard practice. Highlight custom solutions, architectural decisions, and problem-solving approaches.
