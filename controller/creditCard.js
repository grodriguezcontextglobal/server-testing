const { response } = require("express");
const CreditCard = require("../models/CreditCard");

const newCreditCard = async (request, response = response) => {

  let creditCard = new CreditCard(request.body);

  console.log("request body ", request);


  try {

    creditCard.user = request.body.user
    const creaidtCardSaved = await creditCard.save();

    response.status(201).json({
      ok: true,
      msg: "new credit card",
      creditCard: creaidtCardSaved,
    });
  } catch (error) {
    console.log(error);

    response.status(500).json({
      ok: false,
      msg: "Please contact adminitrator",
    });
  }
};

const editCreditCard = async (request, response = response) => {
  const creditCardId = request.params.id;

  try {
    const creditCard = await CreditCard.findById(creditCardId);

    if (!creditCard) {
      return response.status(404).json({
        ok: false,
        msg: "Credit card not found",
      });
    }

    const creditCardEdited = {
      ...request.body,
    };

    const creditCardUpdated = await CreditCard.findByIdAndUpdate(
      creditCardId,
      creditCardEdited,
      {
        new: true,
      }
    ); //3 parameters user id, new user and how it will be returned as new event

    return response.json({
      ok: true,
      creditCard: creditCardUpdated,
    });
  } catch (error) {
    console.log(error);
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
    });
  }
};

module.exports = {
  newCreditCard,
  editCreditCard,
};
