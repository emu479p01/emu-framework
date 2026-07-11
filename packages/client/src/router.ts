import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './stores/session';
import { useMeta } from './stores/meta';
const LoginPage = () => import('./views/LoginPage.vue');
const HomePage = () => import('./views/HomePage.vue');
const ListPage = () => import('./views/ListPage.vue');
const FormPage = () => import('./views/FormPage.vue');
const DesignerPage = () => import('./views/designer/DesignerPage.vue');
const DesignerEditPage = () => import('./views/designer/DesignerEditPage.vue');
const ReportEditPage = () => import('./views/report-designer/ReportEditPage.vue');
const SystemMaintenancePage = () => import('./views/SystemMaintenancePage.vue');

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { public: true } },
    { path: '/', component: HomePage },
    // App-scoped routes
    { path: '/app/:appName', component: HomePage, props: true },
    { path: '/app/:appName/form/:formName', component: ListPage, props: true },
    { path: '/app/:appName/form/:formName/:id', component: FormPage, props: true },
    // Fallback: old flat routes redirect to app-scoped (resolved by first accessible app)
    { path: '/form/:formName', component: ListPage, props: true },
    { path: '/form/:formName/:id', component: FormPage, props: true },
    // Designer (framework-level)
    { path: '/designer', component: DesignerPage },
    // Reports use a dedicated drag-and-drop canvas editor instead of the generic structured-form editor.
    { path: '/designer/new/report', component: ReportEditPage },
    { path: '/designer/report/:name', component: ReportEditPage, props: true },
    { path: '/designer/new/:kind', component: DesignerEditPage, props: (r) => ({ kind: r.params.kind }) },
    { path: '/designer/:kind/:name', component: DesignerEditPage, props: (r) => ({ kind: r.params.kind, name: r.params.name }) },
    { path: '/system/maintenance', component: SystemMaintenancePage },
  ],
});

router.beforeEach(async (to) => {
  const session = useSession();
  if (!session.checked) await session.check();
  if (to.meta.public) return true;
  if (!session.user) return '/login';
  const meta = useMeta();
  if (!meta.meta) await meta.load();
  return true;
});
