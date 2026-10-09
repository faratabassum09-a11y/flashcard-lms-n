const path = require('path');
// Same file the server uses: .env in the PROJECT ROOT (backend/.env is also accepted as a fallback)
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
if (!process.env.MONGO_URI) dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
if (!process.env.MONGO_URI) {
  console.error("MONGO_URI not found. Copy .env.example to .env in the project root (next to package.json) and fill in MONGO_URI.");
  process.exit(1);
}
const mongoose = require("mongoose");
const User = require("../models/user");

mongoose.connect(process.env.MONGO_URI)

async function seedAdmin() {
  try {
    const exists = await User.findOne({ username: "admin" });

    if (exists) {
      console.log("Admin already exists");
      return mongoose.connection.close();
    }

    const pwd = process.env.ADMIN_PASSWORD || "Admin@12345";
    if (!process.env.ADMIN_PASSWORD) console.warn("ADMIN_PASSWORD not set - using the default. Change it after first login (Settings).");
    await User.registerFast({ username: "admin" }, pwd);

    console.log("Admin created");
    mongoose.connection.close();

  } catch (err) {
    console.log(err);
    mongoose.connection.close();
  }
}

seedAdmin();