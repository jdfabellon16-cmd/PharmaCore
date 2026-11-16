import "dotenv/config";
import bcrypt from "bcrypt";
import inquirer from "inquirer";
import { sequelize, User } from "../models/models.js";

try {
  await sequelize.authenticate();
  await sequelize.sync();
  const answers = await inquirer.prompt([
    { type: "input", name: "name", message: "Administrator name:", validate: value => Boolean(value.trim()) || "Name is required." },
    { type: "input", name: "email", message: "Administrator email:", validate: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || "Enter a valid email address." },
    { type: "password", name: "password", message: "Password (minimum 10 characters):", mask: "*", validate: value => value.length >= 10 || "Use at least 10 characters." }
  ]);
  const email = answers.email.trim().toLowerCase();
  if (await User.findOne({ where: { email } })) {
    throw new Error("An account already exists for that email address.");
  }
  await User.create({
    name: answers.name.trim(), email,
    password: await bcrypt.hash(answers.password, 12),
    role: "admin"
  });
  console.log("Administrator created. Sign in at /login.");
} catch (error) {
  console.error("Could not create administrator:", error.message);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
