# create-svelte

Everything you need to build a Svelte project, powered by [`create-svelte`](https://github.com/sveltejs/kit/tree/master/packages/create-svelte).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```bash
# create a new project in the current directory
npm create svelte@latest

# create a new project in my-app
npm create svelte@latest my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://kit.svelte.dev/docs/adapters) for your target environment.

# PWA

PWA is set up using `@vite-pwa/sveltekit`, which is part of `vite-plugin-pwa`. It auto-generates the service worker. 

Sveltekit will register `service-worker.js` automatically, if the file exists. However, the service worker has to be written manually.

Vite plugin PWA will create the service worker and the registration script. This needs to be added manually in the `app.html`.
The manifest also needs to be included in the `<head>`, so that the app can be installed.
