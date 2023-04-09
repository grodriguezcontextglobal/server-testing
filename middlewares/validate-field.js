const express = require('express')
const { validationResult } = require('express-validator')



const validateFields = (request, response, next) => {

    //handle errors
    const errors = validationResult( request );

    if(!errors.isEmpty()){
        return response.status(400).json({
            ok: false,
            errors: errors.mapped()
        })
    }


    next()
}


module.exports = validateFields