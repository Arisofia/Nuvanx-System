const jwt = require('jsonwebtoken');
const secret = '4b8a484bc5f61ec5533b990fff657922dce43fccd21d7136cdbbfefdaa3ac9db';
const payload = {
  id: 'a2f2b8a1-fedb-4a74-891d-b8a2089fd49a',
  email: 'jenineferderas@hotmail.com',
  name: 'Admin'
};
const token = jwt.sign(payload, secret, { expiresIn: '1h' });
console.log(token);
