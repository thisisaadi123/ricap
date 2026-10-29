require("dotenv/config");
const { app, ensureSchema } = require("./app.js");

const PORT = process.env.PORT || 4200;

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`RICap backend listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to apply database migrations:", err);
    process.exit(1);
  });
