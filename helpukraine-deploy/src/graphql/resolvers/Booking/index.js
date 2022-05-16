"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingResolvers = void 0;
const mongodb_1 = require("mongodb");
const api_1 = require("../../../lib/api");
const utils_1 = require("../../../lib/utils");
const millisecondsPerDay = 86400000;
const resolveBookingsIndex = (bookingsIndex, checkInDate, checkOutDate) => {
    let dateCursor = new Date(checkInDate);
    let checkOut = new Date(checkOutDate);
    const newBookingsIndex = Object.assign({}, bookingsIndex);
    while (dateCursor <= checkOut) {
        const y = dateCursor.getUTCFullYear();
        const m = dateCursor.getUTCMonth();
        const d = dateCursor.getUTCDate();
        if (!newBookingsIndex[y]) {
            newBookingsIndex[y] = {};
        }
        if (!newBookingsIndex[y][m]) {
            newBookingsIndex[y][m] = {};
        }
        if (!newBookingsIndex[y][m][d]) {
            newBookingsIndex[y][m][d] = true;
        }
        else {
            throw new Error("selected dates can't overlap dates that have already been booked");
        }
        dateCursor = new Date(dateCursor.getTime() + millisecondsPerDay);
    }
    return newBookingsIndex;
};
exports.bookingResolvers = {
    Mutation: {
        createBooking: (_root, { input }, { db, req }) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const { id, source, checkIn, checkOut } = input;
                // verify a logged in user is making the request
                const viewer = yield utils_1.authorize(db, req);
                if (!viewer) {
                    throw new Error("viewer can't be found");
                }
                // find listing document from database
                const listing = yield db.listings.findOne({ _id: new mongodb_1.ObjectId(id) });
                if (!listing) {
                    throw new Error("listing can't be found");
                }
                // check that viewer is not booking his own listing
                if (listing.host === viewer._id) {
                    throw new Error("viewer can't book own listing");
                }
                // check that checkout > checkin
                const checkInDate = new Date(checkIn);
                const checkOutDate = new Date(checkOut);
                if (checkOutDate < checkInDate) {
                    throw new Error("check out date can't be before check in date");
                }
                // create a new bookingsIndex for listing being booked
                const bookingsIndex = resolveBookingsIndex(listing.bookingsIndex, checkIn, checkOut);
                // get total price to charge
                const totalPrice = listing.price *
                    ((checkOutDate.getTime() - checkInDate.getTime()) / 86400000 + 1);
                // get user document of host
                const host = yield db.users.findOne({ _id: listing.host });
                if (!host || !host.walletId) {
                    throw new Error("the host either can't be found or isn't connected with Stripe");
                }
                // create stripe charge
                yield api_1.Stripe.charge(totalPrice, source, host.walletId);
                // insert new booking in db
                const insertRes = yield db.bookings.insertOne({
                    _id: new mongodb_1.ObjectId(),
                    listing: listing._id,
                    tenant: viewer._id,
                    checkIn,
                    checkOut,
                });
                const insertedBooking = insertRes.ops[0];
                // update host's income in db
                yield db.users.updateOne({ _id: host._id }, { $inc: { income: totalPrice } });
                // update booking field for tenant in db
                yield db.users.updateOne({ _id: viewer._id }, { $push: { bookings: insertedBooking._id } });
                // update booking field for listing in db
                yield db.listings.updateOne({ _id: listing._id }, { $set: { bookingsIndex }, $push: { bookings: insertedBooking._id } });
                // return newly inserted booking
                return insertedBooking;
            }
            catch (error) {
                throw new Error(`Failed to create a booking: ${error}`);
            }
        }),
    },
    Booking: {
        id: ({ _id }) => _id.toString(),
        listing: ({ listing }, _args, { db }) => __awaiter(void 0, void 0, void 0, function* () {
            return db.listings.findOne({ _id: listing });
        }),
        tenant: ({ tenant }, _args, { db }) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield db.users.findOne({ _id: tenant });
            if (!user) {
                throw new Error(`could not find tenant`);
            }
            return user;
        }),
    },
};
