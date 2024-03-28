const { response, request } = require('express')
const { createConnection } = require('mysql2');
require('dotenv').config()

const connection = createConnection({
    connectionLimit: 6000,
    host: 'aws.connect.psdb.cloud',
    user: 'lypzlon9pede4sd8l2sx',
    password: 'pscale_pw_fFRrYmw5LhxWIT9mPLlRol7l4E9mJuLKfEws2r3kcNx',
    database: 'devitrak_db',
    ssl: {
        rejectUnauthorized: false
    }
});

const insertingItem = (request, response) => {
    console.log(request.body)
    try {
        const { category_name, item_group, cost, descript_item, ownership, serial_number, warehouse, company, location } = request.body
        const query = `
                        insert into item_inv
                        (category_name, 
                        item_group, 
                        cost, 
                        descript_item, 
                        ownership, 
                        serial_number, 
                        warehouse, 
                       company, 
                       location)
                        values(?,?,?,?,?,?,?,?,?)`;
        const values = [`${category_name}`, `${item_group}`, `${cost}`, `${descript_item}`, `${ownership}`, `${serial_number}`, warehouse, `${company}`, `${location}`];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response.status(201).json({
                ok: true,
                item: result
            })
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        })
    }
}


const consultingItem = (request, response) => {
    try {
        const reference = Object.entries(request.body)
        const query = `select * from item_inv where \`${reference[0][0]}\`=?`;
        const values = [reference[0][1]];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response.status(201).json({
                ok: true,
                items: result
            })
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
}

const deleteItem = async () => {
    try {
        const query = 'delete from item_inv where item_id=?';
        const values = [request.body.item_id];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response?.status(201)?.json({
                ok: true,
                item_deleted: result
            })
        });
    } catch (error) {
        console.error('Error:', error.message);
    }
}

const consultingItemTable = async (request, response) => {
    try {
        const query = 'select * from item_inv where company=?;';
        const values = [`${request.body.company}`];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response?.status(201)?.json({
                ok: true,
                items: result
            })
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
}

const consultingItemInWarehouseTable = (request, response) => {
    try {
        const query = 'select * from item_inv where company=? and warehouse =?';
        const values = [`${request.body.company}`, request.body.warehouse];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            })

            return response?.status(201)?.json({
                ok: true,
                items: result
            })

        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
}

const updateItemInTable = async (request, response) => {
    try {
        const { category_name, item_group, cost, descript_item, serial_number, warehouse, location, ownership, company, create_at, update_at, item_id } = request.body;
        const query = `UPDATE item_inv 
                        SET category_name=?,
                            item_group=?,  
                            cost=?,
                            descript_item=?,
                            serial_number=?,
                            warehouse=?,
                            location=?,
                            ownership=?,
                            company=?,
                            status=?,
                            create_at=?,
                            update_at=?
                        WHERE item_id=?;`;
        const values = [category_name, item_group, cost, descript_item, serial_number, warehouse, location, ownership, company, status, create_at, update_at, item_id];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(401).json({
                ok: false,
                msg: `${err.message}`,
            });
            return response?.status(201)?.json({
                ok: true,
                items: result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
};

const updateItemInWarehouseAfterBeingAddedToEvent = async (request, response) => {
    try {
        const { warehouse, item_group, min_serial_number, max_serial_number, company } = request.body;

        const query = `
            UPDATE item_inv 
            SET warehouse = ?, update_at = NOW()
            WHERE item_group = ? AND serial_number BETWEEN ? AND ? And company = ?`;

        const values = [warehouse, item_group, min_serial_number, max_serial_number, company];

        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(401).json({
                ok: false,
                msg: `${err.message}`,
            });
            return response.status(201).json({
                ok: true,
                msg: 'Items updated successfully in the warehouse',
                updated_items: result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
};

const returningItemToStockWhenEventIsFinished = async (request, response) => {
    try {
        const { warehouse,
            status,
            update_at,
            serial_number,
            category_name,
            item_group,
            company } = request.body;
            console.log("🚀 ~ returningItemToStockWhenEventIsFinished ~ request.body:", request.body)
        const query = ` UPDATE
        item_inv
    SET
        warehouse =?,
        status =?,
        update_at =?
    WHERE
        serial_number =?
        and category_name = ?
        and item_group = ?
        and company = ?;`;
        const values = [warehouse,
            status,
            update_at,
            serial_number,
            category_name,
            item_group,
            company];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(401).json({
                ok: false,
                msg: `${err.message}`,
            });
            return response?.status(201)?.json({
                ok: true,
                items: result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
};

const itemFinalStatusWhenEventIsFinished = async (request, response) => {
    try {
        const { status,
            condition,
            updated_at,
            serial_number,
            event_id } = request.body;
        const query = `
                UPDATE item_inv_assigned_event iiae
                JOIN item_inv ii ON iiae.item_id = ii.item_id
                SET iiae.status = ?, iiae.condition = ?, iiae.updated_at = ?
                WHERE ii.serial_number = ?
                AND iiae.event_id = ?;
                    `;
        const values = [status,
            condition,
            updated_at,
            serial_number,
            event_id];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(401).json({
                ok: false,
                msg: `${err.message}`,
            });
            return response?.status(201)?.json({
                ok: true,
                items: result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
};


const consultingInventoryTracking = (request, response) => {
    try {
        const item_id = request.params.id
        const query = `
        SELECT ii.item_id,ii.serial_number,ii.location, ii.warehouse, ii.category_name, ii.item_group, ii.cost, ii.ownership, iiae.status, iiae.condition, ei.event_name
        FROM item_inv ii
        LEFT JOIN item_inv_assigned_event iiae ON iiae.item_id = ii.item_id
        LEFT JOIN event_info ei ON ei.event_id = iiae.event_id
        WHERE ii.item_id = ?
        ORDER by ii.update_at ASC
        `;
        const values = [item_id];
        connection.execute(query, values, function (err, result, fields) {
            if (err) return response.status(500).json({
                ok: false,
                msg: `${err.message}`,
            });

            return response.status(201).json({
                ok: true,
                result
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        response.status(500).json({
            ok: false,
            msg: `${error.message}`,
        });
    }
};

module.exports = {
    consultingItem,
    insertingItem,
    consultingItemTable,
    consultingItemInWarehouseTable,
    deleteItem,
    updateItemInTable,
    updateItemInWarehouseAfterBeingAddedToEvent,
    consultingInventoryTracking,
    returningItemToStockWhenEventIsFinished,
    itemFinalStatusWhenEventIsFinished,
}