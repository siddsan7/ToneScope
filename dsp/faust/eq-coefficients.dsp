declare name "ToneScopeEqCoefficients";
declare version "0.1.0";
// RBJ low shelf (type 0), peaking bell (1), high shelf (2).
design(kind,hz,q,db,sr) = b0/a0,b1/a0,b2/a0,a1/a0,a2/a0 with {
    A = pow(10.0,db/40.0);
    w = 2.0*3.14159265358979323846*hz/sr;
    c = cos(w); s = sin(w); alpha = s/(2.0*q);
    t = 2.0*sqrt(A)*s/sqrt(2.0);
    pick(low,bell,high) = select2(kind==1,select2(kind==0,high,low),bell);
    a0 = pick((A+1.0)+(A-1.0)*c+t,1.0+alpha/A,(A+1.0)-(A-1.0)*c+t);
    b0 = pick(A*((A+1.0)-(A-1.0)*c+t),1.0+alpha*A,A*((A+1.0)+(A-1.0)*c+t));
    b1 = pick(2.0*A*((A-1.0)-(A+1.0)*c),-2.0*c,-2.0*A*((A-1.0)+(A+1.0)*c));
    b2 = pick(A*((A+1.0)-(A-1.0)*c-t),1.0-alpha*A,A*((A+1.0)+(A-1.0)*c-t));
    a1 = pick(-2.0*((A-1.0)+(A+1.0)*c),-2.0*c,2.0*((A-1.0)-(A+1.0)*c));
    a2 = pick((A+1.0)+(A-1.0)*c-t,1.0-alpha/A,(A+1.0)-(A-1.0)*c-t);
};
process = design;
