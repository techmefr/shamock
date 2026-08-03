// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mdx from '@astrojs/mdx';

export default defineConfig({
	site: 'https://techmefr.github.io',
	base: '/chaff',
	integrations: [
		starlight({
			title: 'chaff',
			description: 'Schema-driven mock/fallback engine — validate fixtures against any Standard Schema, optional MirageJS server.',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/techmefr/chaff' },
			],
			head: [
				{ tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
				{ tag: 'meta', attrs: { property: 'og:site_name', content: 'chaff' } },
				{ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
			],
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'Introduction', slug: 'introduction' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Pairing with nexdk', slug: 'guides/pairing-with-nexdk' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'chaff API', slug: 'reference/chaff' },
					],
				},
			],
		}),
		mdx(),
	],
});
