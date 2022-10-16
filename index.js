const express = require('express')
const { dbConnection } = require('./database/config')
const cors = require('cors')
require('dotenv').config() //connect with dotenv file

///crear el servidor de express
const app = express()

//Database
dbConnection() 

//cors
app.use(cors())


//directorio publico
app.use( express.static('public'))


//lectura y parseo del body
app.use( express.json())

//rutas
//TODO: auth // crear, login, renew
app.use('/api/auth', ( require('./routes/auth')))
app.use('/api/creditCard', ( require('./routes/creditCard')))
app.use('/api/stripe', require('./routes/stripe'))
app.use('/api/admin', require('./routes/admin'))
app.use('/api/receiver', require('./routes/receivers'))
app.use('/api/article', require('./routes/article'))
app.use('/api/staff', require('./routes/staff'))



//escuchar peticiones
app.listen( process.env.PORT, () => {
    console.log('Server on Port', process.env.PORT )
})
