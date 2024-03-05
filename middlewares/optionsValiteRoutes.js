const express = require('express')

const optionsValidRoutes = [
    '/article/article-delete',
    '/article/article-edit/:id',
    '/auth/:id',
    '/event/edit-event/:id',
    '/event/edit-event/:id',
    '/event/edit-staff-event/:id',
    '/stripe/remove-duplicate-transaction/:id',
    '/stripe/remove-duplicate/:id',
]


module.exports = optionsValidRoutes