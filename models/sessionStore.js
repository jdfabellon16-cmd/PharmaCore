import session from "express-session";
import connectSessionSequelize from "connect-session-sequelize";
import { sequelize } from "./db.js";

const SequelizeStore = connectSessionSequelize(session.Store);

export const sessionStore = new SequelizeStore({
  db: sequelize,
  tableName: "sessions",
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 8 * 60 * 60 * 1000
});
