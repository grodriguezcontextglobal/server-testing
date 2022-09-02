/**
 * Rutas ed Eventos / Events
 * host + /api/events
 */

const { Router } = require("express");
const router = Router();
const { check } = require("express-validator");
const { validateJWT } = require("../middlewares/validate-jwt");
const { getEvents, createEvent, editEvent, deleteEvent } = require('../controller/Events');
const validateFields = require("../middlewares/validate-field");
const { isDate } = require("../helpers/isDate");


//todas tienes que pasar la validacion
router.use( validateJWT )

//obtener evento
router.get('/', getEvents )

//crear evento
router.post('/', [
    // 
    check('title', 'el title es obligatorio').not().isEmpty(),
    check('note', 'la nota es obligatorio').not().isEmpty(),
    check('start', 'Fecha es obligatorio').custom( isDate ),
    check('end', 'Fecha es obligatorio').custom( isDate ),
    validateFields

], createEvent)

//editar evento
router.put('/:id', editEvent)

//eliminar evento
router.delete('/:id', deleteEvent)


module.exports = router;