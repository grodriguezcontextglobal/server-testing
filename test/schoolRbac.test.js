'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const routePath = require.resolve('../mysql/routes/school');
const validateJwtPath = require.resolve('../middlewares/validate-jwt');
const checkTokenVersionPath = require.resolve('../middlewares/checkValidateToken');
const requireIndustryPath = require.resolve('../middlewares/requireIndustry');
const authorizePermissionPath = require.resolve('../middlewares/authorizePermission');
const auditPiiAccessPath = require.resolve('../middlewares/auditPiiAccess');

function marker(name, metadata = {}) {
  const fn = (req, res, next) => next();
  Object.defineProperty(fn, 'name', { value: name });
  Object.assign(fn, metadata);
  return fn;
}

function getRouteHandlers(router, method, routePathname) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePathname && l.route.methods[method.toLowerCase()]
  );
  if (!layer) return null;
  return layer.route.stack.map((l) => l.handle);
}

function loadSchoolRouterWithMiddlewareMarkers() {
  const originals = new Map(
    [
      routePath,
      validateJwtPath,
      checkTokenVersionPath,
      requireIndustryPath,
      authorizePermissionPath,
      auditPiiAccessPath,
    ].map((modulePath) => [modulePath, require.cache[modulePath]])
  );
  const validateJWT = marker('validateJWT');
  const checkTokenVersion = marker('checkTokenVersion');
  const auditPiiAccess = marker('auditPiiAccess', { auditResource: 'SchoolPII' });

  let router;
  try {
    delete require.cache[routePath];
    require.cache[validateJwtPath] = { exports: { validateJWT } };
    require.cache[checkTokenVersionPath] = { exports: { checkTokenVersion } };
    require.cache[requireIndustryPath] = {
      exports: {
        requireIndustry: (industry) => marker(`requireIndustry:${industry}`, { industry }),
      },
    };
    require.cache[authorizePermissionPath] = {
      exports: {
        authorizePermission: (resource, action) =>
          marker(`authorizePermission:${resource}:${action}`, { permission: { resource, action } }),
      },
    };
    require.cache[auditPiiAccessPath] = {
      exports: {
        auditPiiAccess: (resource) => marker(`auditPiiAccess:${resource}`, { auditResource: resource }),
      },
    };

    router = require(routePath);
  } finally {
    for (const [modulePath, cachedModule] of originals) {
      if (cachedModule) {
        require.cache[modulePath] = cachedModule;
      } else {
        delete require.cache[modulePath];
      }
    }
  }

  return { router, validateJWT, checkTokenVersion };
}

function assertSchoolRbacChain(handlers, expectedAction, markers) {
  assert.ok(handlers, 'route must exist');
  assert.equal(handlers[0], markers.validateJWT, 'route must require a valid JWT first');
  assert.equal(handlers[1], markers.checkTokenVersion, 'route must check token version after JWT validation');
  assert.deepEqual(
    handlers[2]?.industry,
    'Education',
    'route must require the authenticated company to be in the Education industry'
  );
  assert.deepEqual(
    handlers[3]?.permission,
    { resource: 'member', action: expectedAction },
    `route must require member:${expectedAction} permission`
  );
}

test('mysql/routes/school.js: auditPiiAccess("SchoolPII") remains first router middleware', () => {
  const { router } = loadSchoolRouterWithMiddlewareMarkers();
  assert.equal(router.stack[0].handle.auditResource, 'SchoolPII');
});

test('mysql/routes/school.js: read routes require JWT, Education industry, and member:read', () => {
  const markers = loadSchoolRouterWithMiddlewareMarkers();
  const readRoutes = [
    '/dashboard',
    '/roster',
    '/guardians',
    '/consent',
    '/consent/status',
    '/settings',
    '/student/export',
  ];

  for (const route of readRoutes) {
    assertSchoolRbacChain(getRouteHandlers(markers.router, 'POST', route), 'read', markers);
  }
});

test('mysql/routes/school.js: create routes require JWT, Education industry, and member:create', () => {
  const markers = loadSchoolRouterWithMiddlewareMarkers();
  const createRoutes = ['/guardians/add', '/consent/record'];

  for (const route of createRoutes) {
    assertSchoolRbacChain(getRouteHandlers(markers.router, 'POST', route), 'create', markers);
  }
});

test('mysql/routes/school.js: update routes require JWT, Education industry, and member:update', () => {
  const markers = loadSchoolRouterWithMiddlewareMarkers();
  const updateRoutes = ['/settings/consent-enforcement', '/student/erase'];

  for (const route of updateRoutes) {
    assertSchoolRbacChain(getRouteHandlers(markers.router, 'POST', route), 'update', markers);
  }
});
