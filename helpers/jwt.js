const jwt = require('jsonwebtoken')

const generateJWT = ( uid, name ) => {

return new Promise( (resolve, reject)  => {

    const payload = { uid, name };

    console.log('token',{uid, name })

    jwt.sign( payload, process.env.SECRET_JWT_SEED, {
        expiresIn: '1h'
    }, (error, token ) => {

        if ( error ) {
            console.log(error)
            reject('Could not generate token')
        }

        resolve( token )
    })

})




}


module.exports = {
    generateJWT
}