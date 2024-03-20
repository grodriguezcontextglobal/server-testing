const express = require("express");
const Company = require("../models/Company");



const createCompany = async (request, response = express.response) => {
    try {
        const { company_name,
            address,
            phone,
            owner,
            website,
            main_email,
            industry,
            stripe_customer_id,
            employees
        } = request.body
        let companyInfo = await Company.findOne({ company_name });
        if (!companyInfo) {
            companyInfo = new Company({
                company_name: company_name,
                address: {
                    street: address.street,
                    city: address.city,
                    state: address.state,
                    postal_code: address.postal_code
                },
                phone: {
                    main: phone.main,
                    alternative: phone.alternative,
                },
                owner: {
                    first_name: owner.first_name,
                    last_name: owner.last_name,
                    email: owner.email
                },
                website,
                main_email,
                industry,
                stripe_customer_id,
                employees: [{
                    user: employees.at(-1).user,
                    super_user: employees.at(-1).super_user,
                    role: employees.at(-1).role
                }]
            });

            await companyInfo.save();

            return response.status(201).json({
                ok: true,
                message: "registered",
                company: companyInfo
            });
        }

    } catch (error) {
        console.log(error);
        response.status(500).json({
            ok: false,
            msg: "Please contact Administrator",
        });
    }
};

const updatingCompany = async (request, response = express.response) => {
    try {
        const paramsId = request.params.id
        let companyInfo = await Company.findById(paramsId)
        if (!companyInfo) {
            response.status(500).json({
                ok: false,
                msg: "No company in record.",
            });
        }
        let newData = {
            ...request.body
        }
        const companyInfoUpdated = await Company.findByIdAndUpdate(
            paramsId,
            newData,
            {
                new: true,
            }
        );
        return response.status(201).json({
            ok: true,
            company: companyInfoUpdated
        })

    } catch (error) {
        console.log(error);
        response.status(500).json({
            ok: false,
            msg: "Please contact Administrator",
        });
    }
};
const searchingCompany = async (request, response = express.response) => {
    try {
        let companyInfo = await Company.findOne(request.body);
        if (!companyInfo) {
            response.status(500).json({
                ok: false,
                msg: "No company in record.",
            });
        }

        return response.status(201).json({
            ok: true,
            company: companyInfo
        })

    } catch (error) {
        console.log(error);
        response.status(500).json({
            ok: false,
            msg: "Please contact Administrator",
        });
    }
};

const getCompanyList = async (request, response = express.response) => {
    try {
        let companyInfo = await Company.find();
        if (!companyInfo) {
            response.status(500).json({
                ok: false,
                msg: "No company in record.",
            });
        }

        return response.status(201).json({
            ok: true,
            company: companyInfo
        })

    } catch (error) {
        console.log(error);
        response.status(500).json({
            ok: false,
            msg: "Please contact Administrator",
        });
    }
};

module.exports = {
    createCompany,
    searchingCompany,
    getCompanyList,
    updatingCompany,
};
