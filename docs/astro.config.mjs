// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';
import starlight from '@astrojs/starlight';
import mdx from '@astrojs/mdx';

export default defineConfig({
	image: { service: passthroughImageService() },
	site: 'https://techmefr.github.io',
	base: '/shamock',
	integrations: [
		starlight({
			title: 'shamock',
			logo: { light: './src/assets/logo.svg', dark: './src/assets/logo-dark.svg', alt: '' },
			description: 'Schema-driven mock engine — validate fixtures against any Standard Schema and serve them from an in-process mock API.',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/techmefr/shamock' },
			],
			customCss: ['./src/styles/custom.css'],
			head: [
				{ tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
				{ tag: 'meta', attrs: { property: 'og:site_name', content: 'shamock' } },
				{ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
			],
			expressiveCode: { defaultProps: { frame: 'terminal' } },
			favicon: '/favicon.svg',
			sidebar: [
    {
        "label": "Start here",
        "items": [
            {
                "label": "Introduction",
                "slug": "introduction"
            },
            {
                "label": "Installation & quickstart",
                "slug": "getting-started"
            }
        ]
    },
    {
        "label": "Guides",
        "items": [
            {
                "label": "Fixtures & validation",
                "slug": "guides/fixtures"
            },
            {
                "label": "Offline fallback",
                "slug": "guides/offline-fallback"
            },
            {
                "label": "Mock API",
                "slug": "guides/mocking"
            },
            {
                "label": "Pairing with neXdk",
                "slug": "guides/pairing-with-nexdk"
            }
        ]
    },
    {
        "label": "Reference",
        "items": [
            {
                "label": "shamock API",
                "slug": "reference/shamock"
            }
        ]
    },
    {
        "label": "Ecosystem",
        "items": [
            {
                "label": "neXdk",
                "link": "https://github.com/techmefr/nexdk"
            },
            {
                "label": "beepr",
                "link": "https://github.com/techmefr/beepr"
            },
            {
                "label": "dialectr",
                "link": "https://github.com/techmefr/dialectr"
            }
        ]
    }
],

		}),
		mdx(),
	],
});
