// ********************** Initialize server **********************************

const app = require('../index'); //Import the Express application

// ********************** Import Libraries ***********************************

const chai = require('chai'); // Chai HTTP provides an interface for live integration testing of the API's.
const chaiHttp = require('chai-http');
chai.should();
chai.use(chaiHttp);
const {assert, expect} = chai;

// ********************** DEFAULT WELCOME TESTCASE ****************************

describe('Server!', () => {
  // Sample test case given to test / endpoint.
  it('Returns the default welcome message', done => {
    chai
      .request(app)
      .get('/welcome')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.status).to.equals('success');
        assert.strictEqual(res.body.message, 'Welcome!');
        done();
      });
  });
});

// *********************** TODO: WRITE 2 UNIT TESTCASES **************************

// ********************************************************************************

describe('Testing Add User API', () => {
  it('positive : /register', done => {
    chai
      .request(app)
      .post('/register')
      .send({
        username: 'testuser',
        password: 'testpassword123'
      })
      .end((err, res) => {
        expect(res).to.have.status(200);
        done();
      });
  });

  it('Negative : /register. Checking invalid name', done => {
    chai
      .request(app)
      .post('/register')
      .send({
        username: null,
        password: 'testpassword123'
      })      
      .end((err, res) => {
        expect(res).to.have.status(400);
        expect(res.body.message).to.equals('Invalid input');
        done();
      });
  });
});