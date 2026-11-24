# IVAO Philippines - Public UI Demo

Front-end only preview of the IVAO Philippines website (Angular). The backend is not included or hosted, so pages that load data or log in will not work.

## View online

The site is published with GitHub Pages by the workflow in `.github/workflows/pages.yml` on every push to `main`.
In the repository, open Settings > Pages and set Source to "GitHub Actions". The address is `https://<github-user>.github.io/<repository-name>/`.

## Profile Settings

Open Log In and enter any email and password: the demo signs you in as a dummy user (no backend is involved), and Profile Settings appears in the user menu. Changes are kept in your browser only.

## Run locally

    cd web
    npm ci
    npm start
