const express = require("express");
const app = express();
const nodemailer = require("nodemailer");
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
// const e = require("express");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = 5000;

const corsOptions = {
  origin: ["http://localhost:5173", "https://server-pearl-iota-83.vercel.app","https://simple-firebase-form-b6244.web.app"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASS}@cluster0.paptp.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// send email
const sendEmail = (emailAddress, emailData) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // Use `true` for port 465, `false` for all other ports
    auth: {
      user: process.env.TRANSPORTER_EMAIL,
      pass: process.env.TRANSPORTER_PASS,
    },
  });

  // verify transporter
  // verify connection configuration
  transporter.verify(function (error, success) {
    if (error) {
      console.log(error);
    } else {
      console.log("Server is ready to take our messages");
    }
  });
  const mailBody = {
    from: `"Multi-Vendor Medicine Selling E-commerce Website" <${process.env.TRANSPORTER_EMAIL}>`, // sender address
    to: emailAddress, // list of receivers
    subject: emailData.subject, // Subject line
    html: emailData.message, // html body
  };

  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log("Email Sent: " + info.response);
    }
  });
};

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  // console.log(token);
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

async function run() {
  try {
    const db = client.db("medicine-selling");
    const productsCollection = db.collection("products");
    const usersCollection = db.collection("users");
    const categoriesCollection = db.collection("categories");
    const advertisesCollection = db.collection("advertises");
    const bannerSlidersCollection = db.collection("banner-sliders");
    const cartProductsCollection = db.collection("carts-products");
    const bookingsCollection = db.collection("bookings");

    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      // console.log(result?.role);
      if (!result || result?.role !== "Admin") return res.status(401).send({ message: "unauthorized access!!" });

      next();
    };
    // verify host middleware
    const verifyHost = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      // console.log(result?.role);
      if (!result || result?.role !== "Seller") {
        return res.status(401).send({ message: "unauthorized access!!" });
      }

      next();
    };

    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // create payment intent
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { amount } = req.body;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // Save a booking data in db
    app.post("/booking", verifyToken, async (req, res) => {
      const bookingData = req.body;
      // save room booking info
      const result = await bookingsCollection.insertOne(bookingData);
      // send email to user/customers
      sendEmail(bookingData?.user_Info?.email || bookingData?.email, {
        subject: "Booking Successful!",
        message: `You've successfully booked a Product through Multi-Vendor Medicine Selling E-commerce Website. Transaction Id: ${bookingData.transactionId}`,
      });
      // send email to seller
      sendEmail(bookingData.cartItems[0]?.seller_Info?.email, {
        subject: "Your Products got booked!",
        message: `Get ready to welcome ${bookingData.cartItems[0]?.user_Info?.name}.`,
      });
      res.send(result);
    });
    // invoice page data
    app.get("/invoice-page/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.findOne(query);
      res.send(result);
    });

    // Get all users data from db
    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // save a user data in db
    app.put("/user", async (req, res) => {
      const user = req.body;

      const query = { email: user?.email };
      // check if user already exists in db
      const isExist = await usersCollection.findOne(query);
      if (isExist) {
        if (user.status === "Requested") {
          // if existing user try to change his role
          const result = await usersCollection.updateOne(query, {
            $set: { status: user?.status },
          });
          return res.send(result);
        } else {
          // if existing user login again
          return res.send(isExist);
        }
      }

      // save user for the first time
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      // welcome new user
      sendEmail(user?.email, {
        subject: "Welcome to Multi-Vendor Medicine Selling E-commerce Website!",
        message: `Hope you will find you Products`,
      });
      res.send(result);
    });

    //update a user role
    app.patch("/users/update/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email };
      const updateDoc = {
        $set: { ...user, timestamp: Date.now() },
      };
      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // All Get Request Start

    // payment history
    app.get("/payments/history/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      // console.log("query-->", query, "params-->", email);
      const payments = await bookingsCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(payments);
    });

    //  get all paid / pending products
    app.get("/payments", verifyToken, verifyAdmin, async (req, res) => {
      const pending = await cartProductsCollection.find({ status: "pending" }).toArray();
      const paid = await bookingsCollection.find({ status: { $in: ["paid", "approved"] } }).toArray();
      res.send({ pending, paid });
    });
    // Accept Payment (Pending → Paid)
    app.patch("/accept-payment/:id", async (req, res) => {
      const id = req.params.id;

      const pendingPayment = await cartProductsCollection.findOne({ _id: new ObjectId(id) });

      if (!pendingPayment) {
        return res.status(404).send({ message: "Payment not found" });
      }

      // Insert into bookingsCollection
      await bookingsCollection.insertOne({
        ...pendingPayment,
        status: "approved",
        paidAt: new Date(),
        transactionId: "manual_admin_payment",
      });

      // Remove from cartCollection
      await cartProductsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ success: true });
    });

    // get a user info by email from db
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // Get all products data from db
    app.get("/products", async (req, res) => {
      const result = await productsCollection.find().toArray();
      res.send(result);
    });

    // Get a single products data from db
    app.get("/product/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.findOne(query);
      res.send(result);
    });
    // all shop page data
    app.get("/all-products", async (req, res) => {
      const { sort, filter, search } = req.query;
      const query = {};
      // Multi-word search
      if (search) {
        const terms = search.trim().split(" ");
        query.$and = terms.map((term) => ({
          itemName: { $regex: term, $options: "i" },
        }));
      }
      // filter by category
      if (filter) {
        query.category = filter;
      }
      let cursor = productsCollection.find(query);
      // sorting
      if (sort === "asc") {
        cursor = cursor.sort({ price_per_unit: 1 }); // or createdAt
      } else if (sort === "dsc") {
        cursor = cursor.sort({ price_per_unit: -1 });
      }
      const result = await cursor.toArray();
      res.send(result);
    });

    // Get all jobs data count from db
    app.get("/products-count", async (req, res) => {
      const { filter, search } = req.query;
      const query = {};
      // filter by category
      if (filter) {
        query.category = filter;
      }
      // search by product name
      if (search) {
        query.itemName = { $regex: search, $options: "i" };
      }
      const count = await productsCollection.countDocuments(query);
      res.send({ count });
    });

    // all discount products
    app.get("/discount-products", async (req, res) => {
      const query = { discount: { $gt: 0 } };
      const result = await productsCollection.find(query).toArray();
      res.send(result);
    });

    // get all advertises data with db
    app.get("/advertises", verifyToken, async (req, res) => {
      const result = await advertisesCollection.find().toArray();
      res.send(result);
    });

    // specific category
    app.get("/products-category/:category", async (req, res) => {
      const category = req.params.category;
      const result = await productsCollection.find({ category }).toArray();
      res.send(result);
    });
    // specific user email get all products
    app.get("/products/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "seller_Info.email": email };
      const result = await productsCollection.find(query).toArray();
      res.send(result);
    });
    // banner sliders get all data
    app.get("/banner-sliders", async (req, res) => {
      const result = await bannerSlidersCollection.find().toArray();
      res.send(result);
    });
    // specif user carts page data get
    app.get("/carts/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "user_Info.email": email };
      const result = await cartProductsCollection.find(query).toArray();
      res.send(result);
    });
    // admin home page
    app.get("/admin-home", verifyToken, verifyAdmin, async (req, res) => {
      const bookingDetails = await bookingsCollection
        .find(
          {},
          {
            projection: {
              // date: 1,
              totalPrice: 1,
            },
          },
        )
        .toArray();
      const revenue = await bookingsCollection
        .aggregate([
          {
            $match: { status: "paid" }, // optional but recommended
          },
          {
            $group: {
              _id: null,
              totalPrice: {
                $sum: { $toDouble: "$totalPrice" },
              },
            },
          },
        ])
        .toArray();
      const totalPrice = revenue[0]?.totalPrice || 0;

      const totalUsers = await usersCollection.countDocuments();
      const totalProducts = await productsCollection.countDocuments();
      res.send({
        totalUsers,
        totalProducts,
        totalBookings: bookingDetails.length,
        totalPrice,
      });
    });

    app.get("/admin/sales-report", verifyToken, verifyAdmin, async (req, res) => {
      const { startDate, endDate } = req.query;
      let query = {};
      if (startDate && endDate) {
        query.createdAt = {
          $gte: `${startDate}T00:00:00.000Z`,
          $lte: `${endDate}T23:59:59.999Z`,
        };
      }
      // console.log("Final String Query:", query);
      const result = await bookingsCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(result);
    });

    // seller home page
    app.get("/seller-home", verifyToken, verifyHost, async (req, res) => {
      const sellerEmail = req.user.email;
      const totalProducts = await productsCollection.countDocuments({
        "seller_Info.email": sellerEmail,
      });
      const totalBookings = await bookingsCollection.countDocuments({
        email: sellerEmail,
      });
      const totalPending = await cartProductsCollection.countDocuments();
      res.send({
        totalProducts,
        totalPending,
        totalBookings,
      });
    });

    // All Get Request End

    // All post request Start

    // create a slider image & save db
    app.post("/banner-slider", verifyToken, verifyAdmin, async (req, res) => {
      const bannerSlider = req.body;
      const result = await bannerSlidersCollection.insertOne(bannerSlider);
      res.send(result);
    });
    // create a product & save db
    app.post("/product", verifyToken, verifyHost, async (req, res) => {
      const productData = req.body;
      const result = await productsCollection.insertOne(productData);
      res.send(result);
    });
    // create category & save db
    app.post("/categories", verifyToken, verifyAdmin, async (req, res) => {
      const { categoryName, image, itemName } = req.body;
      // Cloudinary URL
      const result = await categoriesCollection.insertOne({
        categoryName,
        itemName,
        image,
        createdAt: new Date(),
      });
      res.send(result);
    });
    // advertise added with db
    app.post("/advertise", verifyToken, verifyAdmin, async (req, res) => {
      const advertiseData = req.body;
      const result = await advertisesCollection.insertOne(advertiseData);
      res.send(result);
    });

    app.post("/cart", verifyToken, async (req, res) => {
      const bookingData = req.body;
      const result = await cartProductsCollection.insertOne(bookingData);
      res.send(result);
    });

    // All post request End

    //  Manage Category Page start

    app.get("/categories", verifyToken, async (req, res) => {
      const result = await categoriesCollection.find().toArray();
      res.send(result);
    });
    // cart quantity updates
    app.patch("/cart-update/:id", async (req, res) => {
      const id = req.params.id;
      const updateQty = req.body;
      // console.log(updateQty);
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: updateQty,
      };
      const result = await cartProductsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.put("/categories/update/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const catData = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: catData,
      };
      const options = { upsert: false };
      const result = await categoriesCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // banner slide img delete
    app.delete("/banner-slide/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bannerSlidersCollection.deleteOne(query);
      res.send(result);
    });
    // delete category
    app.delete("/category/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await categoriesCollection.deleteOne(query);
      res.send(result);
    });
    // delete cart
    app.delete("/cart/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      // console.log(itemId);
      const query = { _id: new ObjectId(id) };
      const result = await cartProductsCollection.deleteOne(query);
      res.send(result);
    });
    app.delete("/carts/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "user_Info.email": email };
      const result = await cartProductsCollection.deleteMany(query);
      res.send(result);
    });
    //  Manage Category page end
    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
