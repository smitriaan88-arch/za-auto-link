module.exports = (req, res) => {
  res.status(200).send("Serverless function is working. Time: " + new Date().toISOString());
};
