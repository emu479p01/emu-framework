import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './stores/session';
import { useMeta, type Metadata } from './stores/meta';
const LoginPage = () => import('./views/LoginPage.vue');
const SetupPage = () => import('./views/SetupPage.vue');
const HomePage = () => import('./views/HomePage.vue');
const ListPage = () => import('./views/ListPage.vue');
const FormPage = () => import('./views/FormPage.vue');
const DesignerPage = () => import('./views/designer/DesignerPage.vue');
const DesignerEditPage = () => import('./views/designer/DesignerEditPage.vue');
const ReportEditPage = () => import('./views/report-designer/ReportEditPage.vue');
const SystemMaintenancePage = () => import('./views/SystemMaintenancePage.vue');
const FontManagerPage = () => import('./views/FontManagerPage.vue');
const SmtpSettingsPage = () => import('./views/SmtpSettingsPage.vue');
const ActionPage = () => import('./views/ActionPage.vue');
const TableBrowserPage = () => import('./views/TableBrowserPage.vue');
const ReportLaunchPage = () => import('./views/ReportLaunchPage.vue');

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { public: true } },
    { path: '/setup', component: SetupPage, meta: { public: true } },
    { path: '/', component: HomePage },
    // App-scoped routes
    { path: '/app/:appName', component: HomePage, props: true },
    { path: '/app/:appName/form/:formName', component: ListPage, props: true },
    { path: '/app/:appName/form/:formName/:id', component: FormPage, props: true },
    // Fallback: old flat routes redirect to app-scoped (resolved by first accessible app)
    { path: '/form/:formName', component: ListPage, props: true },
    { path: '/form/:formName/:id', component: FormPage, props: true },
    // Designer (framework-level)
    { path: '/designer', component: DesignerPage, meta: { capability: 'designer' } },
    { path: '/designer/app/:appName', component: DesignerPage, meta: { capability: 'designer' } },
    { path: '/designer/app/:appName/model/:modelName', component: DesignerPage, meta: { capability: 'designer' } },
    { path: '/designer/app/:appName/model/:modelName/new/report', component: ReportEditPage, meta: { capability: 'designer' } },
    { path: '/designer/app/:appName/model/:modelName/report/:name', component: ReportEditPage, props: true, meta: { capability: 'designer' } },
    { path: '/designer/app/:appName/model/:modelName/new/:kind', component: DesignerEditPage, props: (r) => ({ kind: r.params.kind }), meta: { capability: 'designer' } },
    { path: '/designer/app/:appName/model/:modelName/:kind/:name', component: DesignerEditPage, props: (r) => ({ kind: r.params.kind, name: r.params.name }), meta: { capability: 'designer' } },
    // Reports use a dedicated drag-and-drop canvas editor instead of the generic structured-form editor.
    { path: '/designer/new/report', component: ReportEditPage, meta: { capability: 'designer' } },
    { path: '/designer/report/:name', component: ReportEditPage, props: true, meta: { capability: 'designer' } },
    { path: '/designer/new/:kind', component: DesignerEditPage, props: (r) => ({ kind: r.params.kind }), meta: { capability: 'designer' } },
    { path: '/designer/:kind/:name', component: DesignerEditPage, props: (r) => ({ kind: r.params.kind, name: r.params.name }), meta: { capability: 'designer' } },
    { path: '/system/maintenance', component: SystemMaintenancePage, meta: { capability: 'maintenance' } },
    { path: '/system/fonts', component: FontManagerPage, meta: { capability: 'maintenance' } },
    { path: '/system/integrations/smtp', component: SmtpSettingsPage, meta: { capability: 'maintenance' } },
    { path: '/system/tables', component: TableBrowserPage, meta: { capability: 'tableBrowser' } },
    { path: '/action/:name', component: ActionPage, props: true },
    { path: '/report/:name', component: ReportLaunchPage, props: true },
  ],
});

router.beforeEach(async (to) => {
  const session = useSession();
  if (!session.checked) await session.check();
  if (session.setupRequired && to.path !== '/setup') return '/setup';
  if (!session.setupRequired && to.path === '/setup') return session.user ? '/' : '/login';
  if (to.meta.public) return true;
  if (!session.user) return '/login';
  const meta = useMeta();
  if (!meta.meta) await meta.load();
  const capability = to.meta.capability as keyof Metadata['capabilities'] | undefined;
  if (capability && !meta.meta?.capabilities[capability]) return '/';
  const formName = String(to.params.formName ?? '');
  if (formName && !meta.form(formName)) return '/';
  return true;
});
