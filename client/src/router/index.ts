import Vue from 'vue';
import VueRouter, { type RouteConfig } from 'vue-router';
import { getAuthToken } from '@/api/auth';
import AuthGate from '@/components/AuthGate.vue';
import OverviewView from '@/views/OverviewView.vue';
import ServersView from '@/views/ServersView.vue';
import ProxmoxView from '@/views/ProxmoxView.vue';
import DockerView from '@/views/DockerView.vue';
import UpsView from '@/views/UpsView.vue';
import OpnsenseView from '@/views/OpnsenseView.vue';
import SwitchesView from '@/views/SwitchesView.vue';
import HikvisionView from '@/views/HikvisionView.vue';
import UnifiView from '@/views/UnifiView.vue';
import TopologyView from '@/views/TopologyView.vue';
import TailscaleView from '@/views/TailscaleView.vue';
import SettingsView from '@/views/SettingsView.vue';

Vue.use(VueRouter);

const LAST_ROUTE_KEY = 'rackpanel:lastRoute';

// Prevent benign NavigationDuplicated console errors in Vue Router v3
const originalPush = VueRouter.prototype.push;
VueRouter.prototype.push = function push(location: any) {
  return (originalPush.call(this, location) as any).catch((err: any) => {
    if (err && (err.name === 'NavigationDuplicated' || err._isRouter)) {
      return this.currentRoute;
    }
    throw err;
  });
};

const originalReplace = VueRouter.prototype.replace;
VueRouter.prototype.replace = function replace(location: any) {
  return (originalReplace.call(this, location) as any).catch((err: any) => {
    if (err && (err.name === 'NavigationDuplicated' || err._isRouter)) {
      return this.currentRoute;
    }
    throw err;
  });
};

export function getSavedLastRoute(): string {
  try {
    const saved = window.localStorage.getItem(LAST_ROUTE_KEY);
    if (saved && saved.indexOf('/') === 0 && saved !== '/login' && saved !== '/') {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return '/overview';
}

export function saveLastRoute(fullPath: string): void {
  if (!fullPath || fullPath === '/' || fullPath.indexOf('/login') === 0) return;
  try {
    window.localStorage.setItem(LAST_ROUTE_KEY, fullPath);
  } catch {
    // ignore storage errors
  }
}

const routes: RouteConfig[] = [
  {
    path: '/',
    redirect: () => getSavedLastRoute(),
  },
  {
    path: '/login',
    name: 'login',
    component: AuthGate,
    meta: { public: true },
  },
  {
    path: '/overview',
    name: 'overview',
    component: OverviewView,
    meta: { requiresAuth: true, tab: 'overview' },
  },
  {
    path: '/servers/:serverId?',
    name: 'servers',
    component: ServersView,
    meta: { requiresAuth: true, tab: 'servers' },
  },
  {
    path: '/proxmox/:subTab?',
    name: 'proxmox',
    component: ProxmoxView,
    meta: { requiresAuth: true, tab: 'proxmox' },
  },
  {
    path: '/docker/:subTab?',
    name: 'docker',
    component: DockerView,
    meta: { requiresAuth: true, tab: 'docker' },
  },
  {
    path: '/opnsense/:subTab?',
    name: 'opnsense',
    component: OpnsenseView,
    meta: { requiresAuth: true, tab: 'opnsense' },
  },
  {
    path: '/switches/:subTab?',
    name: 'switches',
    component: SwitchesView,
    meta: { requiresAuth: true, tab: 'switches' },
  },
  {
    path: '/hikvision/:subTab?',
    name: 'hikvision',
    component: HikvisionView,
    meta: { requiresAuth: true, tab: 'hikvision' },
  },
  {
    path: '/unifi/:subTab?',
    name: 'unifi',
    component: UnifiView,
    meta: { requiresAuth: true, tab: 'unifi' },
  },
  {
    path: '/ups',
    name: 'ups',
    component: UpsView,
    meta: { requiresAuth: true, tab: 'ups' },
  },
  {
    path: '/topology/:subTab?',
    name: 'topology',
    component: TopologyView,
    meta: { requiresAuth: true, tab: 'topology' },
  },
  {
    path: '/tailscale',
    name: 'tailscale',
    component: TailscaleView,
    meta: { requiresAuth: true, tab: 'tailscale' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView,
    meta: { requiresAuth: true, tab: 'settings' },
  },
  {
    path: '*',
    redirect: '/overview',
  },
];

const router = new VueRouter({
  mode: 'history',
  routes,
  scrollBehavior() {
    return { x: 0, y: 0 };
  },
});

// Convert legacy hash URLs (e.g. /#/opnsense/interfaces) cleanly into history routes
router.beforeEach((to, _from, next) => {
  if (to.hash && to.hash.indexOf('#/') === 0) {
    const cleanPath = to.hash.slice(1);
    next({ path: cleanPath, replace: true });
    return;
  }

  const hasToken = Boolean(getAuthToken());

  if (to.matched.some((r) => r.meta && r.meta.requiresAuth) && !hasToken) {
    saveLastRoute(to.fullPath);
    next({
      name: 'login',
      query: to.fullPath && to.fullPath !== '/overview' ? { redirect: to.fullPath } : undefined,
      replace: true,
    });
    return;
  }

  next();
});

router.afterEach((to) => {
  if (to.name && to.name !== 'login') {
    saveLastRoute(to.fullPath);
  }
  const scroller = document.querySelector('.workspace-scroll');
  if (scroller) {
    scroller.scrollTop = 0;
  }
});

export default router;
